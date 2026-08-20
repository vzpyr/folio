package com.vzpyr.folio

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.WindowCompat
import io.crates.keyring.Keyring
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : TauriActivity() {
  private val contentReady = AtomicBoolean(false)

  override fun onCreate(savedInstanceState: Bundle?) {
    val splash = installSplashScreen()
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    Keyring.initializeNdkContext(applicationContext)
    splash.setKeepOnScreenCondition { !contentReady.get() }
  }

  fun updateStatusBarTheme(isLight: Boolean) {
    Handler(Looper.getMainLooper()).post {
      val insetsController = WindowCompat.getInsetsController(window, window.decorView)
      insetsController.isAppearanceLightStatusBars = isLight
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.addJavascriptInterface(
      object {
        @JavascriptInterface
        fun ready() {
          contentReady.set(true)
        }

        @JavascriptInterface
        fun setTheme(theme: String) {
          updateStatusBarTheme(theme == "light")
        }
      },
      "FolioSplash",
    )
    Handler(Looper.getMainLooper()).postDelayed({ contentReady.set(true) }, 3000)
  }
}