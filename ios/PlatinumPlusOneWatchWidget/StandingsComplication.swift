// The watch-face complication: who leads and by how much. It loads the scoring feed every 30 minutes,
// and its timeline also holds an entry for the moment the standings seal, so it goes dark on time
// whether or not a reload has run.

import SwiftUI
import WidgetKit

struct GlanceEntry: TimelineEntry {
    let date: Date
    let glance: Glance
}

struct StandingsProvider: TimelineProvider {
    func placeholder(in context: Context) -> GlanceEntry {
        GlanceEntry(date: Date(), glance: .placeholder)
    }

    func getSnapshot(in context: Context, completion: @escaping (GlanceEntry) -> Void) {
        let contest = Feed.cached()
        completion(GlanceEntry(date: Date(), glance: contest == nil && context.isPreview ? .placeholder
                                                    : Glance(contest: contest, at: Date())))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<GlanceEntry>) -> Void) {
        Task {
            let contest: Contest?
            do { contest = try await Feed.load() } catch { contest = Feed.cached() }
            let now = Date()
            var moments = [now]
            var next = now.addingTimeInterval(30 * 60)
            if let contest {
                moments += [contest.sealAt, contest.contestEnd].filter { $0 > now }
                // Reload right after takeoff for the final results.
                if contest.contestEnd > now && contest.contestEnd < next { next = contest.contestEnd.addingTimeInterval(60) }
            }
            let entries = moments.map { GlanceEntry(date: $0, glance: Glance(contest: contest, at: $0)) }
            completion(Timeline(entries: entries, policy: .after(next)))
        }
    }
}

struct StandingsComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: GlanceEntry

    var body: some View {
        switch family {
        case .accessoryCircular:
            GlanceCircular(glance: entry.glance)
        case .accessoryInline:
            GlanceInline(glance: entry.glance)
        case .accessoryCorner:
            Text(cornerText)
                .font(.title3.weight(.bold))
                .widgetCurvesContent()
                .widgetLabel { Text(entry.glance.headline) }
        default:
            GlanceRectangular(glance: entry.glance)
        }
    }

    private var cornerText: String {
        switch entry.glance.kind {
        case .live, .final: return entry.glance.badge + entry.glance.badgeValue
        case .sealed: return "🔒"
        default: return "+1"
        }
    }
}

@main
struct StandingsComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "PlatinumPlusOneStandings", provider: StandingsProvider()) { entry in
            StandingsComplicationView(entry: entry)
                .containerBackground(for: .widget) { Color.clear }
        }
        .configurationDisplayName("Platinum +1")
        .description("Who leads, and by how much.")
        .supportedFamilies([.accessoryRectangular, .accessoryCircular, .accessoryInline, .accessoryCorner])
    }
}
