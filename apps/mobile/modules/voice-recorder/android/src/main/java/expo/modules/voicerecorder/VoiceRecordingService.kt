package expo.modules.voicerecorder

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

// 앱이 백그라운드로 가도 프로세스와 마이크 접근이 유지되도록 녹음 중에만 띄운다.
// 녹음 자체는 VoiceRecorderModule이 하고, 이 서비스는 알림만 소유한다.
class VoiceRecordingService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val manager = getSystemService(NotificationManager::class.java)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "녹음", NotificationManager.IMPORTANCE_LOW).apply {
          setShowBadge(false)
          setSound(null, null)
        })
    }

    val openApp = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE)
    }
    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("녹음 중")
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setContentIntent(openApp)
      .setOngoing(true)
      .setSilent(true)
      .build()

    ServiceCompat.startForeground(
      this,
      NOTIFICATION_ID,
      notification,
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0)

    return START_NOT_STICKY
  }

  private companion object {
    const val CHANNEL_ID = "voice-recording"
    const val NOTIFICATION_ID = 7301
  }
}
