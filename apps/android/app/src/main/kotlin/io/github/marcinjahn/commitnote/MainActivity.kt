package io.github.marcinjahn.commitnote

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import io.github.marcinjahn.commitnote.shell.ShellRoute
import io.github.marcinjahn.commitnote.ui.CommitnoteTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            CommitnoteTheme {
                ShellRoute()
            }
        }
    }

    override fun onStop() {
        super.onStop()
        (application as CommitnoteApplication).flushBlobCache()
    }
}
