import Foundation

// The contest as the scoring feed describes it, and the standings worked out the way the standings page
// does (app.js: ranking, phaseOf, dayOf). Shared by the watch app and its complication.
//
// The feed sends every ruling at all times. During the final 24 hours the page hides the standings, so
// everything here that shows standings checks phase(at:) first.

struct Contest: Codable, Equatable {
    struct Day: Codable, Equatable {
        let n: Int
        let label: String
        let zone: String
        let start: Date
        let end: Date
    }

    struct Entry: Codable, Equatable {
        let t: Date
        let c: String
        let p: Int
        let r: String
    }

    let name: String
    let generatedAt: Date
    let contestStart: Date
    let contestEnd: Date
    let sealAt: Date
    let days: [Day]
    let competitors: [String]
    let entries: [Entry]

    enum Phase { case practice, live, sealed, final }

    func phase(at now: Date) -> Phase {
        if now >= contestEnd { return .final }
        if now >= sealAt { return .sealed }
        if now < contestStart { return .practice }
        return .live
    }

    func day(at now: Date) -> Day? { days.first { now >= $0.start && now < $0.end } }

    /// The most recent ruling.
    var latest: Entry? { entries.max { $0.t < $1.t } }

    /// Total points, then most points earned, then fewest points lost. Equal on all three shares the rank.
    func ranking() -> [Standing] {
        var rows: [String: Standing] = [:]
        for name in competitors { rows[name] = Standing(name: name) }
        for e in entries {
            var row = rows[e.c] ?? Standing(name: e.c)
            row.total += e.p
            if e.p > 0 { row.earned += e.p } else { row.lost += e.p }
            rows[e.c] = row
        }
        func order(_ name: String) -> Int { competitors.firstIndex(of: name) ?? Int.max }
        var list = rows.values.sorted {
            if $0.total != $1.total { return $0.total > $1.total }
            if $0.earned != $1.earned { return $0.earned > $1.earned }
            if $0.lost != $1.lost { return $0.lost > $1.lost }
            return order($0.name) < order($1.name)
        }
        for i in list.indices {
            guard i > 0 else { list[i].rank = 1; continue }
            let prev = list[i - 1]
            if prev.total == list[i].total && prev.earned == list[i].earned && prev.lost == list[i].lost {
                list[i].rank = prev.rank
            } else {
                list[i].rank = i + 1
            }
        }
        return list
    }

    /// Each competitor's color on the standings page, by their place in the competitor list.
    func colorIndex(of name: String) -> Int { (competitors.firstIndex(of: name) ?? 0) % 3 }
}

struct Standing: Equatable, Identifiable {
    let name: String
    var total = 0
    var earned = 0
    var lost = 0     // the sum of negative rulings, so zero or below
    var rank = 0
    var id: String { name }

    var tier: Tier? { Tier(rawValue: rank) }
}

enum Tier: Int {
    case platinum = 1, zinc, wood

    var label: String { ["Platinum", "Zinc", "Wood"][rawValue - 1] }
    var icon: String { ["🏆", "🔩", "🪵"][rawValue - 1] }
}

extension Array where Element == Standing {
    var leaders: [Standing] { filter { $0.rank == 1 } }

    /// The page's headline: "Kathy leads by 2", "Kathy leads on the tie-breaker", "Jen and Kathy share the lead".
    var leadLine: String {
        let top = leaders
        guard let first = top.first else { return "No rulings yet" }
        if top.count > 1 { return Self.listNames(top.map(\.name)) + " share the lead" }
        guard count > 1 else { return "\(first.name) leads" }
        let gap = first.total - self[1].total
        return gap > 0 ? "\(first.name) leads by \(gap)" : "\(first.name) leads on the tie-breaker"
    }

    /// "Kathy 3 · Blas 2 · Jen 0"
    var scoreLine: String { map { "\($0.name) \($0.total)" }.joined(separator: " · ") }

    static func listNames(_ names: [String]) -> String {
        guard names.count > 1 else { return names.first ?? "" }
        return names.dropLast().joined(separator: ", ") + " and " + names.last!
    }
}

extension Int {
    /// +2, +1, -1, -2
    var signed: String { self > 0 ? "+\(self)" : "\(self)" }
}

/// Reads the scoring feed and keeps the last good copy for when the network is out.
enum Feed {
    static let url = URL(string: "https://script.google.com/macros/s/AKfycbz9HfhX-Xb_JmhfRE4Pf8ppzuBaus2GZch9GQ-psnHx9PAwenvbK0I6_9cK-acBGPWO/exec")!

    private static var cacheFile: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("contest.json")
    }

    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        d.dateDecodingStrategy = .custom { decoder in
            let s = try decoder.singleValueContainer().decode(String.self)
            if let date = withFraction.date(from: s) ?? plain.date(from: s) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Bad date \(s)"))
        }
        return d
    }()

    /// The latest standings from the feed, saved for next time.
    static func load() async throws -> Contest {
        var parts = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        parts.queryItems = [URLQueryItem(name: "t", value: String(Int(Date().timeIntervalSince1970)))]
        let request = URLRequest(url: parts.url!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        let contest = try decoder.decode(Contest.self, from: data)
        try? data.write(to: cacheFile, options: .atomic)
        return contest
    }

    /// The last copy that loaded, if any.
    static func cached() -> Contest? {
        guard let data = try? Data(contentsOf: cacheFile) else { return nil }
        return try? decoder.decode(Contest.self, from: data)
    }
}

enum Clock {
    /// "1d 4h 05m", "3h 12m": time left until a moment.
    static func until(_ date: Date, from now: Date) -> String {
        let s = max(0, Int(date.timeIntervalSince(now)))
        let d = s / 86400, h = (s % 86400) / 3600, m = (s % 3600) / 60
        return d > 0 ? "\(d)d \(h)h \(String(format: "%02d", m))m" : "\(h)h \(String(format: "%02d", m))m"
    }

    /// The page's style: 12s ago, 5m ago, 3h ago, 2d ago.
    static func ago(_ date: Date, from now: Date) -> String {
        let s = max(0, Int(now.timeIntervalSince(date).rounded()))
        if s < 60 { return "\(s)s ago" }
        let m = Int((Double(s) / 60).rounded())
        if m < 60 { return "\(m)m ago" }
        let h = Int((Double(m) / 60).rounded())
        if h < 48 { return "\(h)h ago" }
        return "\(Int((Double(h) / 24).rounded()))d ago"
    }
}
