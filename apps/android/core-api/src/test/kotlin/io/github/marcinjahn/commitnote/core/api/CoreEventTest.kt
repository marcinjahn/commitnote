package io.github.marcinjahn.commitnote.core.api

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class CoreEventTest {
    private fun event(text: String): CoreEvent {
        val message = assertInstanceOf(CoreMessage.Event::class.java, CoreWire.parse(text))
        return CoreEvent.decode(message.event)
    }

    @Test
    fun `loadingProgress decodes its step`() {
        assertEquals(
            CoreEvent.LoadingProgress(LoadingStep.DERIVING_KEYS, "Deriving keys"),
            event(
                """{"kind":"event","event":"loadingProgress","payload":{"step":"derivingKeys","message":"Deriving keys"}}""",
            ),
        )
    }

    @Test
    fun `treeChanged decodes nested folders, notes and tag options`() {
        val decoded =
            event(
                """{"kind":"event","event":"treeChanged","payload":{"tree":[""" +
                    """{"kind":"folder","name":"Work","path":["Work"],""" +
                    """"noteCount":1,"children":[""" +
                    """{"kind":"note","name":"Plan","path":["Work","Plan"],""" +
                    """"colorTag":"blue","shared":false}]},""" +
                    """{"kind":"note","name":"Todo","path":["Todo"],""" +
                    """"colorTag":null,"shared":true}],""" +
                    """"tagFilter":null,"usedTags":["blue"],"tagsWritable":true,""" +
                    """"tagOptions":[{"tag":"blue","label":"Blue"}]}}""",
            )

        assertEquals(
            CoreEvent.TreeChanged(
                tree =
                    listOf(
                        TreeNode.Folder(
                            "Work",
                            listOf("Work"),
                            1,
                            listOf(
                                TreeNode.Note("Plan", listOf("Work", "Plan"), ColorTag.BLUE, false),
                            ),
                        ),
                        TreeNode.Note("Todo", listOf("Todo"), null, true),
                    ),
                tagFilter = null,
                usedTags = listOf(ColorTag.BLUE),
                tagsWritable = true,
                tagOptions = listOf(TagOptionView(ColorTag.BLUE, "Blue")),
            ),
            decoded,
        )
    }

    @Test
    fun `treeChanged allows an absent tree`() {
        val decoded =
            event(
                """{"kind":"event","event":"treeChanged","payload":{"tree":null,""" +
                    """"tagFilter":null,"usedTags":[],"tagsWritable":false,"tagOptions":[]}}""",
            )

        assertEquals(
            CoreEvent.TreeChanged(null, null, emptyList(), false, emptyList()),
            decoded,
        )
    }

    @Test
    fun `sessionEnded decodes its reason`() {
        assertEquals(
            CoreEvent.SessionEnded(SessionEndReason.LOGGED_OUT),
            event("""{"kind":"event","event":"sessionEnded","payload":{"reason":"loggedOut"}}"""),
        )
    }

    @Test
    fun `notice decodes with and without an action`() {
        val plain =
            event(
                """{"kind":"event","event":"notice","payload":{"id":"n1","tone":"info",""" +
                    """"message":"Saved","persistent":false,"action":null}}""",
            )
        val undo =
            event(
                """{"kind":"event","event":"notice","payload":{"id":"n2","tone":"success",""" +
                    """"message":"Trashed","persistent":true,"action":{"kind":"undo","label":"Undo"}}}""",
            )
        val open =
            event(
                """{"kind":"event","event":"notice","payload":{"id":"n3","tone":"warning",""" +
                    """"message":"Copy","persistent":false,""" +
                    """"action":{"kind":"openNote","label":"Open note","path":["A"]}}}""",
            )

        assertEquals(CoreEvent.Notice("n1", NoticeTone.INFO, "Saved", false, null), plain)
        assertEquals(
            CoreEvent.Notice("n2", NoticeTone.SUCCESS, "Trashed", true, NoticeAction.Undo("Undo")),
            undo,
        )
        assertEquals(
            CoreEvent.Notice(
                "n3",
                NoticeTone.WARNING,
                "Copy",
                false,
                NoticeAction.OpenNote("Open note", listOf("A")),
            ),
            open,
        )
    }

    @Test
    fun `noticeCleared decodes its id`() {
        assertEquals(
            CoreEvent.NoticeCleared("n1"),
            event("""{"kind":"event","event":"noticeCleared","payload":{"id":"n1"}}"""),
        )
    }

    @Test
    fun `a known event without a typed payload is unmodelled`() {
        val decoded =
            event("""{"kind":"event","event":"syncStateChanged","payload":{"online":true}}""")

        assertEquals(
            CoreEvent.Unmodelled(
                "syncStateChanged",
                buildJsonObject {
                    put("online", true)
                },
            ),
            decoded,
        )
    }

    @Test
    fun `no event name of the API is reported as unknown`() {
        for (name in CoreNames.events) {
            val failure =
                runCatching {
                    CoreEvent.decode(RawEvent(name, JsonObject(emptyMap())))
                }.exceptionOrNull()

            assertFalse(
                failure is CoreMessageException &&
                    failure.reason == CoreMessageException.Reason.UNKNOWN_EVENT,
                name,
            )
        }
    }

    @Test
    fun `an event name outside the API is rejected`() {
        val error =
            assertThrows(CoreMessageException::class.java) {
                event("""{"kind":"event","event":"visitCounted","payload":{}}""")
            }

        assertEquals(CoreMessageException.Reason.UNKNOWN_EVENT, error.reason)
    }

    @Test
    fun `a typed event with the wrong shape is rejected`() {
        val error =
            assertThrows(CoreMessageException::class.java) {
                event(
                    """{"kind":"event","event":"loadingProgress","payload":{"step":"mystery","message":"m"}}""",
                )
            }

        assertEquals(CoreMessageException.Reason.SHAPE, error.reason)
    }
}
