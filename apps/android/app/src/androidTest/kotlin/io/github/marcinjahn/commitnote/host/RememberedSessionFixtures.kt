package io.github.marcinjahn.commitnote.host

import io.github.marcinjahn.commitnote.core.api.ForgeKind
import io.github.marcinjahn.commitnote.core.api.Secret
import io.github.marcinjahn.commitnote.core.runtime.services.RememberedKeys
import io.github.marcinjahn.commitnote.core.runtime.services.RememberedSession
import io.github.marcinjahn.commitnote.core.runtime.services.RepositoryCoordinates
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull

fun sampleSession(): RememberedSession =
    RememberedSession(
        repoUrl = "https://github.com/octocat/notes",
        coordinates = RepositoryCoordinates(ForgeKind.GITHUB, "octocat", "notes"),
        accessToken = Secret("token-0123456789"),
        keys =
            RememberedKeys(
                contentKey = ByteArray(32) { it.toByte() },
                nameKey = ByteArray(32) { (it + 32).toByte() },
                nameIvKey = ByteArray(32) { (it + 64).toByte() },
                keyCheckKey = ByteArray(32) { (it + 96).toByte() },
            ),
    )

fun assertSessionEquals(
    expected: RememberedSession,
    actual: RememberedSession?,
) {
    assertNotNull(actual)
    actual!!
    assertEquals(expected.repoUrl, actual.repoUrl)
    assertEquals(expected.coordinates, actual.coordinates)
    assertEquals(expected.accessToken, actual.accessToken)
    assertArrayEquals(expected.keys.contentKey, actual.keys.contentKey)
    assertArrayEquals(expected.keys.nameKey, actual.keys.nameKey)
    assertArrayEquals(expected.keys.nameIvKey, actual.keys.nameIvKey)
    assertArrayEquals(expected.keys.keyCheckKey, actual.keys.keyCheckKey)
}
