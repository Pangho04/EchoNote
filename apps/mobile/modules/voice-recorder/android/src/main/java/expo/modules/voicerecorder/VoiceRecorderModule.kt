package expo.modules.voicerecorder

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.MediaRecorder
import android.net.Uri
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.nio.ByteOrder
import java.util.UUID
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

// 일반 마이크 입력(MIC)을 증폭·제한해 AAC 파일에 쓴다.
// MediaRecorder는 입력을 키울 수 없어 떨어진 말소리가 작게 남는다.
// 통화용 입력(VOICE_COMMUNICATION)은 말 없는 구간과 먼 말소리를 0으로 지워 전사가 비므로 쓰지 않는다.
class VoiceRecorderModule : Module() {
  private var audioRecord: AudioRecord? = null
  private var muxer: MediaMuxer? = null
  private var trackIndex = -1
  private var worker: Thread? = null

  // getStatus가 JS 스레드에서 읽는 값이다.
  @Volatile private var encoder: MediaCodec? = null
  @Volatile private var fileUri: String? = null
  @Volatile private var isRecording = false
  @Volatile private var framesWritten = 0L

  private var targetGain = 1f
  private var limiterGain = 1f

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("VoiceRecorder")

    Events(STATUS_EVENT)

    AsyncFunction("prepare") { gainDb: Float ->
      prepare(gainDb)
    }

    Function("record") {
      record()
    }

    Function("pause") {
      pause()
    }

    AsyncFunction("stop") {
      teardown()
    }

    Function("getStatus") {
      mapOf(
        "canRecord" to (encoder != null),
        "isRecording" to isRecording,
        "durationMillis" to framesWritten * 1000.0 / SAMPLE_RATE,
        "mediaServicesDidReset" to false,
        "url" to fileUri,
      )
    }

    OnDestroy {
      teardown()
    }
  }

  // 마이크 권한은 JS가 녹음 시작 전에 확인한다.
  @SuppressLint("MissingPermission")
  @Synchronized
  private fun prepare(gainDb: Float) {
    teardown()

    val record = AudioRecord(
      MediaRecorder.AudioSource.MIC,
      SAMPLE_RATE,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
      max(AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT), CHUNK_FRAMES * 2 * 4))

    if (record.state != AudioRecord.STATE_INITIALIZED) {
      record.release()
      throw CodedException("마이크를 열지 못했습니다.")
    }

    val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, SAMPLE_RATE, 1).apply {
      setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
      setInteger(MediaFormat.KEY_BIT_RATE, 128_000)
      setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, CHUNK_FRAMES * 2)
    }
    val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
    val file = File(context.cacheDir, "recording-${UUID.randomUUID()}.m4a")

    codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    codec.start()
    audioRecord = record
    encoder = codec
    muxer = MediaMuxer(file.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    trackIndex = -1
    fileUri = Uri.fromFile(file).toString()
    framesWritten = 0
    targetGain = 10f.pow(gainDb / 20)
    limiterGain = targetGain
  }

  @Synchronized
  private fun record() {
    val record = audioRecord ?: throw CodedException("prepare를 먼저 호출해야 합니다.")

    if (isRecording) return

    record.startRecording()
    isRecording = true
    worker = Thread({ readLoop(record) }, "VoiceRecorder").apply { start() }

    // 알림 권한이 없거나 OS가 거부해도 화면에 있는 동안은 녹음이 된다. 백그라운드 유지만 잃는다.
    try {
      ContextCompat.startForegroundService(context, Intent(context, VoiceRecordingService::class.java))
    } catch (error: Exception) {
      appContext.jsLogger?.warn("녹음 알림 서비스를 시작하지 못했습니다: ${error.message}")
    }
  }

  @Synchronized
  private fun pause() {
    isRecording = false
    // stop이 막혀 있는 read를 풀어 worker가 끝난다.
    runCatching { audioRecord?.stop() }
    worker?.join()
    worker = null
  }

  private fun readLoop(record: AudioRecord) {
    val samples = ShortArray(CHUNK_FRAMES)

    while (isRecording) {
      val count = record.read(samples, 0, samples.size)

      if (count < 0) {
        failRecording("마이크에서 읽지 못했습니다: $count")
        return
      }

      // 일시정지와 겹친 마지막 조각은 버린다.
      if (count == 0 || !isRecording) continue

      applyGain(samples, count)

      try {
        encode(samples, count)
      } catch (error: Exception) {
        failRecording("녹음 파일에 쓰지 못했습니다: ${error.message}")
        return
      }
    }
  }

  // 증폭한 소리가 한계를 넘는 샘플에서 증폭을 바로 줄이고, 이후 서서히 원래 증폭으로 돌린다.
  // ponytail: 미리 보기(look-ahead)가 없어 급한 순간음은 약간 찌그러질 수 있다. 들리면 지연 버퍼를 둔다.
  private fun applyGain(samples: ShortArray, count: Int) {
    for (index in 0 until count) {
      val sample = samples[index] / 32768f

      limiterGain = targetGain - (targetGain - limiterGain) * RELEASE_COEFFICIENT

      if (abs(sample * limiterGain) > LIMITER_CEILING) {
        limiterGain = LIMITER_CEILING / abs(sample)
      }

      samples[index] = (sample * limiterGain * 32767f).roundToInt().toShort()
    }
  }

  private fun encode(samples: ShortArray, count: Int) {
    val codec = encoder ?: return
    var offset = 0

    while (offset < count) {
      val inputIndex = codec.dequeueInputBuffer(TIMEOUT_US)

      if (inputIndex < 0) {
        drain(codec, endOfStream = false)
        continue
      }

      val input = codec.getInputBuffer(inputIndex)!!
      val frames = min(count - offset, input.capacity() / 2)

      input.clear()
      input.order(ByteOrder.nativeOrder()).asShortBuffer().put(samples, offset, frames)
      // 일시정지한 동안은 샘플이 없으므로 시각을 샘플 수로 매겨 재생 길이와 녹음 시간을 맞춘다.
      codec.queueInputBuffer(inputIndex, 0, frames * 2, framesWritten * 1_000_000 / SAMPLE_RATE, 0)
      framesWritten += frames
      offset += frames
      drain(codec, endOfStream = false)
    }
  }

  private fun drain(codec: MediaCodec, endOfStream: Boolean) {
    val info = MediaCodec.BufferInfo()
    var idleCount = 0

    while (true) {
      val index = codec.dequeueOutputBuffer(info, if (endOfStream) TIMEOUT_US else 0)

      if (index == MediaCodec.INFO_TRY_AGAIN_LATER) {
        // 끝 신호가 1초 넘게 안 오면 받은 데까지만 파일에 남긴다.
        if (!endOfStream || ++idleCount > 100) return

        continue
      }

      if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
        trackIndex = muxer!!.addTrack(codec.outputFormat)
        muxer!!.start()
        continue
      }

      if (index < 0) continue

      val isConfig = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0

      if (!isConfig && info.size > 0 && trackIndex >= 0) {
        muxer!!.writeSampleData(trackIndex, codec.getOutputBuffer(index)!!, info)
      }

      codec.releaseOutputBuffer(index, false)

      if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
    }
  }

  private fun failRecording(message: String) {
    isRecording = false
    sendEvent(STATUS_EVENT, mapOf(
      "id" to "voice-recorder",
      "isFinished" to false,
      "hasError" to true,
      "error" to message,
      "url" to fileUri,
      "mediaServicesDidReset" to false,
    ))
  }

  // 녹음 시간과 파일 URL은 stop 뒤 JS가 읽어야 하므로 남긴다.
  @Synchronized
  private fun teardown() {
    pause()

    encoder?.let { codec ->
      runCatching {
        val inputIndex = codec.dequeueInputBuffer(TIMEOUT_US * 100)

        if (inputIndex >= 0) {
          codec.queueInputBuffer(
            inputIndex, 0, 0, framesWritten * 1_000_000 / SAMPLE_RATE, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
          drain(codec, endOfStream = true)
        }
      }
      codec.release()
    }
    // 샘플이 하나도 없으면 muxer가 시작되지 않아 stop이 실패한다.
    muxer?.let { runCatching { if (trackIndex >= 0) it.stop() }; it.release() }
    audioRecord?.release()
    encoder = null
    muxer = null
    audioRecord = null
    runCatching { context.stopService(Intent(context, VoiceRecordingService::class.java)) }
  }

  private companion object {
    const val STATUS_EVENT = "onRecordingStatusUpdate"
    const val SAMPLE_RATE = 48_000
    // AAC 한 프레임(1024)의 두 배씩 읽는다.
    const val CHUNK_FRAMES = 2048
    const val TIMEOUT_US = 10_000L
    // 증폭한 소리가 넘지 않을 최고 크기(-1 dBFS).
    const val LIMITER_CEILING = 0.89f
    // 한계를 넘어 줄인 증폭이 약 200ms에 걸쳐 원래 값으로 돌아온다.
    val RELEASE_COEFFICIENT = exp(-1.0 / (0.2 * SAMPLE_RATE)).toFloat()
  }
}
