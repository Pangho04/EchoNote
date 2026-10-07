import ExpoModulesCore
import UIKit

// 「파일」 앱의 저장 위치 선택 화면으로 파일 사본을 내보낸다.
// 공유창(UIActivityViewController)은 저장했는지 취소했는지 알려주지 않아 쓰지 않는다.
public class DocumentSaverModule: Module {
  // UIDocumentPickerViewController.delegate는 weak라 화면이 닫힐 때까지 붙잡아 둔다.
  private var pickerDelegate: PickerDelegate?

  public func definition() -> ModuleDefinition {
    Name("DocumentSaver")

    // mimeType은 Android 저장 화면용이다. iOS는 파일 확장자로 종류를 판단한다.
    AsyncFunction("saveFileAsync") { (fileUri: URL, _: String, promise: Promise) in
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        throw MissingViewControllerException()
      }

      let picker = UIDocumentPickerViewController(forExporting: [fileUri], asCopy: true)
      let delegate = PickerDelegate { [weak self] result in
        self?.pickerDelegate = nil
        promise.resolve(result)
      }

      picker.delegate = delegate
      // 아래로 밀어 닫으면 취소 콜백이 오지 않을 수 있어 취소 버튼으로만 닫게 한다.
      picker.isModalInPresentation = true
      pickerDelegate = delegate
      presenter.present(picker, animated: true)
    }
    .runOnQueue(.main)
  }
}

private final class PickerDelegate: NSObject, UIDocumentPickerDelegate {
  private let onFinish: (String) -> Void

  init(onFinish: @escaping (String) -> Void) {
    self.onFinish = onFinish
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    onFinish("saved")
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    onFinish("cancelled")
  }
}

internal final class MissingViewControllerException: Exception, @unchecked Sendable {
  override var reason: String {
    "Cannot determine currently presented view controller"
  }
}
