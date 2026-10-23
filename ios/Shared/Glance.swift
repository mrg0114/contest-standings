import SwiftUI
import WidgetKit

// What the watch-face complication shows at a given moment, and how each complication size draws it.
// The watch app's debug gallery draws the same views, so they can be checked without a watch face.

struct Glance {
    enum Kind { case noData, practice, live, sealed, awaitingResults, final }

    var kind: Kind
    var headline: String    // "Kathy leads by 1"
    var scores: String      // "Kathy 3 · Blas 2 · Jen 0"
    var badge = ""          // the leader's initial, or "=" for a shared lead
    var badgeValue = ""     // the leader's points

    init(contest: Contest?, at now: Date) {
        guard let contest else {
            kind = .noData; headline = "Platinum +1"; scores = "Open the app to load"
            return
        }
        switch contest.phase(at: now) {
        case .sealed:
            // Nothing about the standings, however old the data.
            kind = .sealed; headline = "Standings sealed"; scores = "Reveal at takeoff"
        case .final where contest.generatedAt < contest.contestEnd:
            // Rulings can land right up to takeoff, so wait for a copy of the feed from after it.
            kind = .awaitingResults; headline = "Results are in"; scores = "Open the app to see them"
        case .practice:
            kind = .practice; headline = "Practice mode"; scores = "Nothing counts yet"
        case let phase:
            let ranks = contest.ranking()
            let leaders = ranks.leaders
            kind = phase == .final ? .final : .live
            if phase == .final {
                headline = leaders.count > 1
                    ? [Standing].listNames(leaders.map(\.name)) + " share the platinum"
                    : "\(leaders.first?.name ?? "") wins the platinum"
            } else {
                headline = ranks.leadLine
            }
            scores = ranks.scoreLine
            badge = leaders.count > 1 ? "=" : String(leaders.first?.name.prefix(1) ?? "")
            badgeValue = leaders.first.map { "\($0.total)" } ?? ""
        }
    }

    /// For the complication gallery and the widget placeholder.
    init(kind: Kind, headline: String, scores: String, badge: String = "", badgeValue: String = "") {
        self.kind = kind; self.headline = headline; self.scores = scores; self.badge = badge; self.badgeValue = badgeValue
    }

    static let placeholder = Glance(kind: .live, headline: "Kathy leads by 1", scores: "Kathy 3 · Blas 2 · Jen 0",
                                    badge: "K", badgeValue: "3")

    var symbol: String? {
        switch kind {
        case .sealed: return "lock.fill"
        case .awaitingResults, .final: return "trophy.fill"
        default: return nil
        }
    }
}

struct GlanceRectangular: View {
    let glance: Glance

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("PLATINUM +1").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            HStack(spacing: 4) {
                if let symbol = glance.symbol { Image(systemName: symbol) }
                Text(glance.headline)
            }
            .font(.headline).lineLimit(1).minimumScaleFactor(0.6)
            Text(glance.scores).font(.caption).lineLimit(1).minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct GlanceCircular: View {
    let glance: Glance

    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            switch glance.kind {
            case .live, .final:
                VStack(spacing: -2) {
                    Text(glance.badge).font(.title3.weight(.bold))
                    Text(glance.badgeValue).font(.caption2.monospacedDigit())
                }
            case .sealed, .awaitingResults:
                Image(systemName: glance.symbol ?? "lock.fill").font(.title3)
            case .noData, .practice:
                Text("+1").font(.title3.weight(.bold))
            }
        }
    }
}

struct GlanceInline: View {
    let glance: Glance

    var body: some View {
        if let symbol = glance.symbol {
            Label(glance.headline, systemImage: symbol)
        } else {
            Text(glance.headline)
        }
    }
}
