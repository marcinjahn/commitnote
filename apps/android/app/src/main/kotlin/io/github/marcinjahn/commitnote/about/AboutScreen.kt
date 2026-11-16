package io.github.marcinjahn.commitnote.about

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CollectionInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.collectionInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import io.github.marcinjahn.commitnote.BuildConfig
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.core.api.NativeCoreApi
import io.github.marcinjahn.commitnote.ui.FormScaffold
import io.github.marcinjahn.commitnote.ui.Heading
import io.github.marcinjahn.commitnote.ui.openUrl

@Composable
fun AboutScreen(onBack: () -> Unit) {
    FormScaffold(title = stringResource(R.string.about_title), onBack = onBack) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                stringResource(R.string.about_version, BuildConfig.VERSION_NAME),
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.testTag("about-version"),
            )
            Text(
                stringResource(R.string.about_core_api, NativeCoreApi.VERSION),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.testTag("about-core-api"),
            )
            Text(
                stringResource(R.string.about_app_licence),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.testTag("about-app-licence"),
            )
        }
        Heading(stringResource(R.string.about_licences), MaterialTheme.typography.titleMedium)
        Column(
            modifier =
                Modifier.semantics {
                    collectionInfo =
                        CollectionInfo(rowCount = licences.size, columnCount = 1)
                },
        ) {
            licences.forEachIndexed { index, licence ->
                if (index > 0) HorizontalDivider()
                LicenceRow(licence)
            }
        }
    }
}

@Composable
private fun LicenceRow(licence: Licence) {
    var expanded by rememberSaveable(licence.component) { mutableStateOf(false) }
    val state =
        stringResource(
            if (expanded) R.string.about_licence_expanded else R.string.about_licence_collapsed,
        )
    Column(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp)
                    .clickable(role = Role.Button) { expanded = !expanded }
                    .semantics { stateDescription = state }
                    .padding(vertical = 8.dp)
                    .testTag("about-licence-${licence.component}"),
        ) {
            Text(licence.component, style = MaterialTheme.typography.bodyLarge)
            Text(
                licence.licence,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (expanded) LicenceDetails(licence)
    }
}

@Composable
private fun LicenceDetails(licence: Licence) {
    val context = LocalContext.current
    val text by produceState<String?>(null, licence) { value = licence.read(context) }
    TextButton(onClick = { context.openUrl(licence.url) }) {
        Text(stringResource(R.string.about_licence_website, licence.component))
    }
    text?.let {
        Text(
            it,
            style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
            modifier = Modifier.padding(bottom = 8.dp).testTag("about-licence-text"),
        )
    }
}
