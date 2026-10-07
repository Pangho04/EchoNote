package expo.modules.documentsaver

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.Serializable

// 「다른 이름으로 저장」 화면(ACTION_CREATE_DOCUMENT)으로 고른 위치에 파일을 복사한다.
// 공유창은 받은 앱이 저장했는지 알려주지 않고, 삼성 「내 파일」은 공유 대상에 없다.
class DocumentSaverModule : Module() {
  private lateinit var createDocumentLauncher:
    AppContextActivityResultLauncher<CreateDocumentInput, Uri?>

  override fun definition() = ModuleDefinition {
    Name("DocumentSaver")

    RegisterActivityContracts {
      createDocumentLauncher = registerForActivityResult(CreateDocumentContract())
    }

    AsyncFunction("saveFileAsync") Coroutine { fileUri: Uri, mimeType: String ->
      val source = File(requireNotNull(fileUri.path) { "fileUri must be a file:// URI" })
      val target = createDocumentLauncher.launch(CreateDocumentInput(source.name, mimeType))

      if (target == null) {
        "cancelled"
      } else {
        val resolver = (appContext.reactContext ?: throw Exceptions.ReactContextLost()).contentResolver

        try {
          // 큰 녹음도 메모리에 다 올리지 않도록 스트림으로 복사한다.
          source.inputStream().use { input ->
            requireNotNull(resolver.openOutputStream(target, "wt")).use { output ->
              input.copyTo(output)
            }
          }
        } catch (error: Exception) {
          // 저장 화면이 만든 빈 문서가 남지 않게 지운다.
          runCatching { DocumentsContract.deleteDocument(resolver, target) }
          throw error
        }

        "saved"
      }
    }
  }
}

internal data class CreateDocumentInput(val fileName: String, val mimeType: String) : Serializable

internal class CreateDocumentContract :
  AppContextActivityResultContract<CreateDocumentInput, Uri?> {
  override fun createIntent(context: Context, input: CreateDocumentInput): Intent =
    Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = input.mimeType
      putExtra(Intent.EXTRA_TITLE, input.fileName)
    }

  override fun parseResult(input: CreateDocumentInput, resultCode: Int, intent: Intent?): Uri? =
    if (resultCode == Activity.RESULT_OK) intent?.data else null
}
