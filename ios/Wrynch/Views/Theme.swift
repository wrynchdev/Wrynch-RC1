import SwiftUI

/// The web app's colors, so both look like one product.
enum Theme {
    static let paper = Color(hex: 0x0A1020)
    static let card = Color(hex: 0x111A2C)
    static let card2 = Color(hex: 0x17223A)
    static let line = Color(hex: 0x22314D)
    static let ink = Color(hex: 0xE8EEF8)
    static let muted = Color(hex: 0x8C9AB1)
    static let blue = Color(hex: 0x2F6BFF)
    static let blueText = Color(hex: 0x86A8FF)
    static let ok = Color(hex: 0x4CC38A)
    static let monitor = Color(hex: 0xF2B84B)
    static let immediate = Color(hex: 0xF47C75)
    static let na = Color(hex: 0x9AA7BC)
    static let ai = Color(hex: 0xBBA8FF)
    static let aiLine = Color(hex: 0x8B6CF0)

    static func color(_ state: String) -> Color {
        switch state {
        case "ok": return ok
        case "monitor": return monitor
        case "immediate": return immediate
        default: return na
        }
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255, opacity: 1)
    }
}

/// OK / Monitor / Immediate / Not checked / Not rated.
struct StateChip: View {
    let state: String
    var large = false
    var body: some View {
        let c = Theme.color(state)
        HStack(spacing: 4) {
            Image(systemName: icon)
            Text(Labels.state(state))
        }
        .font(large ? .subheadline.weight(.semibold) : .caption.weight(.semibold))
        .padding(.horizontal, large ? 12 : 8).padding(.vertical, large ? 6 : 3)
        .foregroundStyle(c)
        .background(c.opacity(0.16), in: Capsule())
        .accessibilityElement(children: .combine)
    }
    private var icon: String {
        switch state {
        case "ok": return "checkmark.circle"
        case "monitor": return "exclamationmark.triangle"
        case "immediate": return "exclamationmark.octagon"
        case "not_inspected", "unable_to_assess": return "minus.circle"
        default: return "circle.dashed"
        }
    }
}

/// Anything AI-suggested that a technician hasn't confirmed yet.
struct AiChip: View {
    let text: String
    var body: some View {
        Label(text, systemImage: "sparkles")
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .foregroundStyle(Theme.ai)
            .background(Theme.ai.opacity(0.14), in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.aiLine, style: StrokeStyle(lineWidth: 1, dash: [3, 2])))
    }
}

struct Tile: View {
    let value: Int
    let label: String
    let color: Color
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(value)").font(.title.weight(.bold)).foregroundStyle(color)
            Text(label).font(.caption.weight(.semibold)).foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(color.opacity(0.14), in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .combine)
    }
}

struct Card<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 10) { content }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 14))
    }
}

struct AiBox<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 8) { content }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.ai.opacity(0.10), in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.aiLine, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
    }
}

/// A photo from the inspection store (signed link), square-cropped.
struct PhotoThumb: View {
    @Environment(AppModel.self) private var model
    let path: String
    var size: CGFloat = 96
    var pending = false
    var body: some View {
        AsyncImage(url: model.photoURLs[path]) { phase in
            switch phase {
            case .success(let img): img.resizable().scaledToFill()
            default: Rectangle().fill(Theme.card2).overlay(Image(systemName: "photo").foregroundStyle(Theme.muted))
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(pending ? Theme.aiLine : .clear, style: StrokeStyle(lineWidth: 2, dash: [4, 3])))
    }
}

extension View {
    /// Primary, full-width button look.
    func primaryButton(_ enabled: Bool = true) -> some View {
        self.font(.headline).frame(maxWidth: .infinity, minHeight: 50)
            .foregroundStyle(.white)
            .background(enabled ? Theme.blue : Theme.card2, in: RoundedRectangle(cornerRadius: 12))
    }
    func secondaryButton() -> some View {
        self.font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 44)
            .foregroundStyle(Theme.ink)
            .background(Theme.card2, in: RoundedRectangle(cornerRadius: 12))
    }
}
