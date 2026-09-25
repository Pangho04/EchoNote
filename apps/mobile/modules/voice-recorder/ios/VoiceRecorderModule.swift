import AVFoundation
import ExpoModulesCore

// 음성 처리(VP)를 켠 마이크 입력을 증폭·제한해 AAC 파일에 쓴다.
// AVAudioRecorder는 VP를 쓸 수 없어 떨어진 말소리가 작고 소음이 그대로 남는다.
public class VoiceRecorderModule: Module {
  private static let statusEvent = "onRecordingStatusUpdate"
  // 증폭한 소리가 넘지 않을 최고 크기(-1 dBFS).
  private static let limiterCeiling: Float = 0.89
  // 한계를 넘어 줄인 증폭이 약 200ms에 걸쳐 원래 값으로 돌아온다.
  private static let limiterReleaseSeconds = 0.2

  // 입력 경로가 바뀌어 샘플레이트가 달라져도 파일 형식은 그대로 둔다.
  private let fileFormat = AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 1)!

  private var engine: AVAudioEngine?
  private var fileUrl: URL?
  private var observers: [NSObjectProtocol] = []

  // tap 콜백 스레드와 JS 스레드가 함께 읽고 쓰는 값은 lock으로 보호한다.
  private let lock = NSLock()
  private var file: AVAudioFile?
  private var converter: AVAudioConverter?
  private var framesWritten: AVAudioFramePosition = 0
  private var isRecording = false
  private var mediaServicesDidReset = false
  private var hasWriteError = false
  private var targetGain: Float = 1
  private var limiterGain: Float = 1

  public func definition() -> ModuleDefinition {
    Name("VoiceRecorder")

    Events(Self.statusEvent)

    AsyncFunction("prepare") { (gainDb: Float) in
      try self.prepare(gainDb: gainDb)
    }

    Function("record") {
      try self.record()
    }

    Function("pause") {
      self.engine?.pause()
      self.setRecording(false)
    }

    AsyncFunction("stop") {
      self.teardown()
    }

    Function("getStatus") { () -> [String: Any?] in
      self.lock.lock()
      defer { self.lock.unlock() }

      return [
        "canRecord": self.file != nil,
        "isRecording": self.isRecording,
        "durationMillis": Double(self.framesWritten) * 1000 / self.fileFormat.sampleRate,
        "mediaServicesDidReset": self.mediaServicesDidReset,
        "url": self.fileUrl?.absoluteString,
      ]
    }

    OnDestroy {
      self.teardown()
    }
  }

  private func prepare(gainDb: Float) throws {
    teardown()
    try AVAudioSession.sharedInstance().setActive(true)

    let engine = AVAudioEngine()
    try engine.inputNode.setVoiceProcessingEnabled(true)

    let url = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("recording-\(UUID().uuidString).m4a")
    let file = try AVAudioFile(
      forWriting: url,
      settings: [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: fileFormat.sampleRate,
        AVNumberOfChannelsKey: fileFormat.channelCount,
        AVEncoderBitRateKey: 128_000,
      ],
      commonFormat: fileFormat.commonFormat,
      interleaved: fileFormat.isInterleaved)

    self.engine = engine
    self.fileUrl = url
    lock.lock()
    self.file = file
    framesWritten = 0
    mediaServicesDidReset = false
    hasWriteError = false
    targetGain = pow(10, gainDb / 20)
    limiterGain = targetGain
    lock.unlock()
    observeSession(engine: engine)
  }

  private func record() throws {
    guard let engine else {
      throw Exception(name: "NotPrepared", description: "prepare를 먼저 호출해야 합니다.")
    }

    // 소리는 inputNode에서 바로 꺼낸다. 출력(mainMixerNode)에 연결하면 출력 속도에 맞춰 입력을 당겨
    // 입력이 모자란 순간 0이 채워진다.
    // 이어폰 연결처럼 경로가 바뀌면 engine이 멈추고 입력 형식이 달라질 수 있어 멈춰 있으면 tap을 다시 단다.
    if !engine.isRunning {
      let input = engine.inputNode
      let inputFormat = input.outputFormat(forBus: 0)

      lock.lock()
      converter = inputFormat == fileFormat ? nil : AVAudioConverter(from: inputFormat, to: fileFormat)
      lock.unlock()
      input.removeTap(onBus: 0)
      input.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] buffer, _ in
        self?.write(buffer)
      }
      engine.prepare()
      try engine.start()
    }

    setRecording(true)
  }

  private func write(_ buffer: AVAudioPCMBuffer) {
    lock.lock()
    defer { lock.unlock() }

    guard isRecording, let file else { return }

    do {
      let output = try converter.map { try convert(buffer, with: $0) } ?? buffer

      applyGain(to: output)
      try file.write(from: output)
      framesWritten += AVAudioFramePosition(output.frameLength)
    } catch {
      guard !hasWriteError else { return }

      hasWriteError = true
      sendStatus(error: "녹음 파일에 쓰지 못했습니다: \(error.localizedDescription)", mediaServicesDidReset: false)
    }
  }

  private func convert(_ buffer: AVAudioPCMBuffer, with converter: AVAudioConverter) throws -> AVAudioPCMBuffer {
    let capacity = AVAudioFrameCount(
      Double(buffer.frameLength) * fileFormat.sampleRate / buffer.format.sampleRate) + 1

    guard let output = AVAudioPCMBuffer(pcmFormat: fileFormat, frameCapacity: capacity) else {
      throw Exception(name: "ConvertFailed", description: "변환 버퍼를 만들지 못했습니다.")
    }

    var isConsumed = false
    var error: NSError?

    converter.convert(to: output, error: &error) { _, status in
      if isConsumed {
        status.pointee = .noDataNow
        return nil
      }

      isConsumed = true
      status.pointee = .haveData
      return buffer
    }

    if let error { throw error }

    return output
  }

  // 증폭한 소리가 한계를 넘는 샘플에서 증폭을 바로 줄이고, 이후 서서히 원래 증폭으로 돌린다.
  // ponytail: 미리 보기(look-ahead)가 없어 급한 순간음은 약간 찌그러질 수 있다. 들리면 지연 버퍼를 둔다.
  private func applyGain(to buffer: AVAudioPCMBuffer) {
    guard let samples = buffer.floatChannelData?[0] else { return }

    let releaseCoefficient = Float(exp(-1 / (Self.limiterReleaseSeconds * fileFormat.sampleRate)))

    for index in 0..<Int(buffer.frameLength) {
      let sample = samples[index]

      limiterGain = targetGain - (targetGain - limiterGain) * releaseCoefficient

      if abs(sample * limiterGain) > Self.limiterCeiling {
        limiterGain = Self.limiterCeiling / abs(sample)
      }

      samples[index] = sample * limiterGain
    }
  }

  private func observeSession(engine: AVAudioEngine) {
    let center = NotificationCenter.default

    // 전화 같은 중단과 경로 변경은 engine을 멈춘다. 자동으로 재개하지 않고 화면이 돌아올 때 상태를 맞춘다.
    observers = [
      center.addObserver(
        forName: AVAudioSession.interruptionNotification, object: nil, queue: nil
      ) { [weak self] notification in
        let rawType = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt

        if rawType == AVAudioSession.InterruptionType.began.rawValue {
          self?.setRecording(false)
        }
      },
      center.addObserver(
        forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil
      ) { [weak self] _ in
        if !engine.isRunning {
          self?.setRecording(false)
        }
      },
      center.addObserver(
        forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: nil
      ) { [weak self] _ in
        guard let self else { return }

        self.lock.lock()
        self.isRecording = false
        self.mediaServicesDidReset = true
        self.lock.unlock()
        self.sendStatus(error: "오디오 서비스가 재시작되어 녹음이 중단되었습니다.", mediaServicesDidReset: true)
      },
    ]
  }

  private func setRecording(_ value: Bool) {
    lock.lock()
    isRecording = value
    lock.unlock()
  }

  private func sendStatus(error: String, mediaServicesDidReset: Bool) {
    sendEvent(Self.statusEvent, [
      "id": "voice-recorder",
      "isFinished": false,
      "hasError": true,
      "error": error,
      "url": fileUrl?.absoluteString as Any,
      "mediaServicesDidReset": mediaServicesDidReset,
    ])
  }

  // 녹음 시간과 파일 URL은 stop 뒤 JS가 읽어야 하므로 남긴다.
  private func teardown() {
    observers.forEach(NotificationCenter.default.removeObserver)
    observers = []
    engine?.inputNode.removeTap(onBus: 0)
    engine?.stop()
    engine = nil
    lock.lock()
    isRecording = false
    converter = nil
    // AVAudioFile은 해제될 때 파일을 닫는다.
    file = nil
    lock.unlock()
  }
}
