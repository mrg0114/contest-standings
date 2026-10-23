// Platinum +1 Club - the Apple Watch app: the standings, the latest ruling, and a watch-face
// complication (PlatinumPlusOneWatchWidget). It reads the scoring feed itself; notifications come from
// the iPhone app, which iOS forwards to the watch.

import SwiftUI
import WidgetKit

@main
struct PlatinumPlusOneWatchApp: App {
    var body: some Scene {
        WindowGroup { WatchHome() }
    }
}

@MainActor
final class WatchModel: ObservableObject {
    @Published private(set) var contest: Contest? = Feed.cached()
    @Published private(set) var failed = false
    @Published private(set) var updated: Date?

    func refresh() async {
        do {
            let fresh = try await Feed.load()
            if fresh != contest { WidgetCenter.shared.reloadAllTimelines() }
            contest = fresh
            updated = Date()
            failed = false
        } catch {
            failed = true
        }
    }
}

/// Debug builds can pretend it is another moment, to check the sealed and final screens:
/// launch with -PlusOneNow 2026-11-12T03:00:00Z.
enum DebugClock {
    static func now(_ real: Date) -> Date {
        #if DEBUG
        if let s = UserDefaults.standard.string(forKey: "PlusOneNow"), let d = ISO8601DateFormatter().date(from: s) { return d }
        #endif
        return real
    }
}

struct WatchHome: View {
    @StateObject private var model = WatchModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            TimelineView(.periodic(from: .now, by: 30)) { context in
                screen(now: DebugClock.now(context.date))
            }
            .navigationTitle("Platinum +1")
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await model.refresh()
                try? await Task.sleep(nanoseconds: 120 * 1_000_000_000)
            }
        }
    }

    @ViewBuilder
    private func screen(now: Date) -> some View {
        #if DEBUG
        if UserDefaults.standard.bool(forKey: "ComplicationGallery") {
            ComplicationGallery(contest: model.contest)
        } else {
            main(now: now)
        }
        #else
        main(now: now)
        #endif
    }

    @ViewBuilder
    private func main(now: Date) -> some View {
        if let contest = model.contest {
            switch contest.phase(at: now) {
            case .sealed:
                SealedView(contest: contest, now: now)
            case .final where contest.generatedAt < contest.contestEnd:
                // Rulings can land right up to takeoff; wait for the feed from after it.
                Waiting(text: model.failed ? "Can't reach the scoreboard" : "Loading the final results",
                        retry: model.failed ? { Task { await model.refresh() } } : nil)
            case let phase:
                StandingsList(contest: contest, now: now, final: phase == .final, updated: model.updated) {
                    await model.refresh()
                }
            }
        } else {
            Waiting(text: model.failed ? "Can't reach the scoreboard" : "Loading",
                    retry: model.failed ? { Task { await model.refresh() } } : nil)
        }
    }
}

struct StandingsList: View {
    let contest: Contest
    let now: Date
    let final: Bool
    let updated: Date?
    let refresh: () async -> Void

    var body: some View {
        let ranks = contest.ranking()
        List {
            Section {
                Text(statusLine).font(.footnote).foregroundStyle(.secondary)
            }
            Section(final ? "Final results" : "Standings") {
                ForEach(ranks) { r in StandingRow(standing: r, ranks: ranks, contest: contest) }
            }
            if final {
                Section {
                    Text("Congratulations to the platinum. Condolences to the wood.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            if let latest = contest.latest {
                Section("Latest ruling") { RulingRow(entry: latest, contest: contest, now: now) }
            }
            Section {
                Button("Refresh") { Task { await refresh() } }
                if let updated {
                    Text("Updated \(Clock.ago(updated, from: now))").font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
    }

    private var statusLine: String {
        if final { return "Final" }
        if let day = contest.day(at: now) { return "Day \(day.n) of \(contest.days.count) · \(day.zone)" }
        return contest.phase(at: now) == .practice ? "Practice mode" : "Live"
    }
}

struct StandingRow: View {
    let standing: Standing
    let ranks: [Standing]
    let contest: Contest

    var body: some View {
        HStack(spacing: 8) {
            Text(standing.tier?.icon ?? "#\(standing.rank)").font(.title3)
            VStack(alignment: .leading, spacing: 1) {
                Text(standing.name).font(.headline).foregroundStyle(Palette.color(contest.colorIndex(of: standing.name)))
                Text(gap).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
            }
            Spacer(minLength: 4)
            Text("\(standing.total)").font(.title2.weight(.bold).monospacedDigit())
        }
        .accessibilityElement(children: .combine)
    }

    /// The page's wording for each card.
    private var gap: String {
        let leader = ranks.first?.total ?? 0
        if standing.rank == 1 {
            if ranks.leaders.count > 1 { return "tied for the lead" }
            guard ranks.count > 1 else { return "" }
            let lead = standing.total - ranks[1].total
            return lead > 0 ? "leads by \(lead)" : "leads on the tie-breaker"
        }
        return leader == standing.total ? "level, behind on the tie-breaker" : "\(leader - standing.total) behind"
    }
}

struct RulingRow: View {
    let entry: Contest.Entry
    let contest: Contest
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(entry.p.signed)
                    .font(.caption.weight(.bold).monospacedDigit())
                    .padding(.horizontal, 6).padding(.vertical, 1)
                    .background(entry.p > 0 ? Color.green : Color.red, in: Capsule())
                Text(entry.c).font(.headline).foregroundStyle(Palette.color(contest.colorIndex(of: entry.c)))
            }
            if !entry.r.isEmpty { Text(entry.r).font(.footnote) }
            Text(Clock.ago(entry.t, from: now)).font(.caption2).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}

struct SealedView: View {
    let contest: Contest
    let now: Date

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Image(systemName: "lock.fill").font(.title)
                Text("The standings are sealed").font(.headline).multilineTextAlignment(.center)
                Text(Clock.until(contest.contestEnd, from: now)).font(.title3.monospacedDigit())
                Text("No peeking until takeoff from Auckland. The judge is still ruling, so behave.")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            .padding(.top, 4)
        }
    }
}

struct Waiting: View {
    let text: String
    let retry: (() -> Void)?

    var body: some View {
        VStack(spacing: 10) {
            if retry == nil { ProgressView() }
            Text(text).font(.footnote).multilineTextAlignment(.center)
            if let retry { Button("Try again", action: retry) }
        }
    }
}

/// The competitors' colors on the standings page (dark theme, which is how the watch looks).
enum Palette {
    static func color(_ index: Int) -> Color {
        [Color(red: 0x39 / 255, green: 0x87 / 255, blue: 0xe5 / 255),
         Color(red: 0xd9 / 255, green: 0x59 / 255, blue: 0x26 / 255),
         Color(red: 0x19 / 255, green: 0x9e / 255, blue: 0x70 / 255)][index % 3]
    }
}

#if DEBUG
/// Launch with -ComplicationGallery YES to see every complication size in every phase.
struct ComplicationGallery: View {
    let contest: Contest?

    var body: some View {
        let samples: [(String, Glance)] = {
            guard let c = contest else { return [("No data", Glance(contest: nil, at: Date()))] }
            return [("Live", Glance(contest: c, at: Date())),
                    ("Sealed", Glance(contest: c, at: c.sealAt.addingTimeInterval(60))),
                    ("At takeoff", Glance(contest: c, at: c.contestEnd.addingTimeInterval(60)))]
        }()
        List {
            ForEach(samples, id: \.0) { name, glance in
                Section(name) {
                    GlanceRectangular(glance: glance)
                    HStack {
                        GlanceCircular(glance: glance).frame(width: 50, height: 50)
                        GlanceInline(glance: glance).font(.footnote)
                    }
                }
            }
        }
    }
}
#endif
