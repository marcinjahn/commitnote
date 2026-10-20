import NativeCoreAPI
import SwiftUI

struct PassphraseStrengthView: View {
    let strength: PassphraseStrength

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                ForEach(0..<4, id: \.self) { index in
                    Capsule()
                        .fill(index < strength.filledSegments ? fill : Color(.systemFill))
                        .frame(height: 6)
                }
            }
            .accessibilityHidden(true)
            Text(summary)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("init-strength")
    }

    private var fill: Color {
        strength.weak ? .red : .accentColor
    }

    private var summary: String {
        var text = "Passphrase strength: \(strength.label)."
        if strength.score <= 2, !strength.warning.isEmpty {
            text += " \(strength.warning)"
        }
        return text
    }
}
