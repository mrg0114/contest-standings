import SwiftUI

// The Paddock tab: the same message board as the website, drawn natively. It reads and writes the
// Paddock's Apps Script web app the way the page does: the newest 30 posts with the judge's latest
// pinned, older pages on demand, and a passcode to post.

struct PaddockPost: Identifiable, Equatable {
    let id: String
    let iso: String   // the server's timestamp, sent back as the paging cursor
    let date: Date
    let name: String
    let role: String  // judge, competitor, or fan
    let msg: String

    /// Newest first; ties on time broken by id, the order the server uses.
    static func newestFirst(_ a: PaddockPost, _ b: PaddockPost) -> Bool {
        a.date != b.date ? a.date > b.date : a.id > b.id
    }
}

struct PaddockPage {
    var posts: [PaddockPost]
    var hasMore: Bool
    var pinned: PaddockPost?
}

struct PaddockError: Error {
    let message: String
    static let unreachable = PaddockError(message: "Couldn't reach the Paddock. Try again in a moment.")
}

protocol PaddockSource {
    /// The newest page, or the page before `before`.
    func page(before: PaddockPost?) async throws -> PaddockPage
    func send(name: String, message: String, passcode: String) async throws -> PaddockPost
}

/// The Paddock's web app.
struct PaddockServer: PaddockSource {
    private struct Wire: Decodable {
        let id: String
        let t: String
        let name: String
        let role: String
        let msg: String
    }
    private struct WirePage: Decodable {
        let posts: [Wire]
        let hasMore: Bool?
        let pinned: Wire?
    }
    private struct WireReply: Decodable {
        let ok: Bool
        let error: String?
        let post: Wire?
    }

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static func post(_ w: Wire) -> PaddockPost? {
        guard let date = iso.date(from: w.t) else { return nil }
        return PaddockPost(id: w.id, iso: w.t, date: date, name: w.name, role: w.role, msg: w.msg)
    }

    func page(before: PaddockPost?) async throws -> PaddockPage {
        var parts = URLComponents(url: Site.paddockURL, resolvingAgainstBaseURL: false)!
        var query = [URLQueryItem(name: "limit", value: "30"),
                     URLQueryItem(name: "t", value: String(Int(Date().timeIntervalSince1970 * 1000)))]
        if let before {
            query += [URLQueryItem(name: "before", value: before.iso), URLQueryItem(name: "beforeId", value: before.id)]
        }
        parts.queryItems = query
        var request = URLRequest(url: parts.url!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.httpMethod = "GET"
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw PaddockError.unreachable }
        let page = try JSONDecoder().decode(WirePage.self, from: data)
        return PaddockPage(posts: page.posts.compactMap(Self.post).sorted(by: PaddockPost.newestFirst),
                           hasMore: page.hasMore ?? false,
                           pinned: page.pinned.flatMap(Self.post))
    }

    func send(name: String, message: String, passcode: String) async throws -> PaddockPost {
        var request = URLRequest(url: Site.paddockURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.httpMethod = "POST"
        request.setValue("text/plain;charset=utf-8", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["name": name, "message": message, "passcode": passcode])
        let data: Data
        do { (data, _) = try await URLSession.shared.data(for: request) } catch { throw PaddockError.unreachable }
        guard let reply = try? JSONDecoder().decode(WireReply.self, from: data) else { throw PaddockError.unreachable }
        guard reply.ok, let wire = reply.post, let post = Self.post(wire) else {
            throw PaddockError(message: reply.error ?? "That didn't work.")
        }
        return post
    }
}

@MainActor
final class PaddockModel: ObservableObject {
    @Published private(set) var posts: [PaddockPost] = []
    @Published private(set) var pinned: PaddockPost?
    @Published private(set) var hasMore = false
    @Published private(set) var loaded = false
    @Published private(set) var failed = false
    @Published private(set) var loadingOlder = false
    /// Posts newer than the last one seen, for the tab badge.
    @Published private(set) var unseen = 0
    var isViewing = false { didSet { if isViewing { markSeen() } } }

    private let source: PaddockSource
    private var refreshing = false
    private static let seenKey = "paddockSeen"

    init() {
        #if DEBUG
        // Launch with -PaddockDemo YES to page through made-up posts instead of the real board.
        if UserDefaults.standard.bool(forKey: "PaddockDemo") { source = DemoPaddock(); return }
        #endif
        source = PaddockServer()
    }

    /// Fetches the newest page and keeps any older pages already loaded below it.
    func refresh() async {
        guard !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        do {
            let page = try await source.page(before: nil)
            let fresh = page.posts
            var older: [PaddockPost] = []
            if let boundary = fresh.last {
                older = posts.filter { PaddockPost.newestFirst(boundary, $0) }
                // More than a page arrived since the last refresh: there may be a gap, so drop the
                // old pages and let scrolling reload them.
                if let newest = posts.first, PaddockPost.newestFirst(boundary, newest), page.hasMore { older = [] }
            }
            if older.isEmpty { hasMore = page.hasMore }
            posts = fresh + older
            pinned = page.pinned
            loaded = true
            failed = false
            updateUnseen()
        } catch {
            if !loaded { failed = true }
        }
    }

    /// Fetches the page before the oldest post loaded.
    func loadOlder() async {
        guard hasMore, !loadingOlder, let oldest = posts.last else { return }
        loadingOlder = true
        defer { loadingOlder = false }
        guard let page = try? await source.page(before: oldest) else { return }
        let have = Set(posts.map(\.id))
        posts = (posts + page.posts.filter { !have.contains($0.id) }).sorted(by: PaddockPost.newestFirst)
        hasMore = page.hasMore
    }

    /// Posts a message. Returns the error to show, or nil once it is up.
    func send(name: String, message: String, passcode: String) async -> String? {
        do {
            let post = try await source.send(name: name, message: message, passcode: passcode)
            posts.insert(post, at: 0)
            if post.role == "judge" { pinned = post }
            markSeen()
            return nil
        } catch let error as PaddockError {
            return error.message
        } catch {
            return PaddockError.unreachable.message
        }
    }

    func markSeen() {
        if let newest = posts.first { UserDefaults.standard.set(newest.date, forKey: Self.seenKey) }
        unseen = 0
    }

    private func updateUnseen() {
        guard let seen = UserDefaults.standard.object(forKey: Self.seenKey) as? Date else {
            markSeen() // first run: everything already there counts as seen
            return
        }
        if isViewing { markSeen() } else { unseen = posts.filter { $0.date > seen }.count }
    }
}

struct PaddockView: View {
    @ObservedObject var model: PaddockModel
    @State private var composing = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Talk, trash talk, and appeals. Appeals are heard never.")
                        .font(.subheadline).foregroundStyle(.secondary)
                    Button { composing = true } label: { Label("Write a post", systemImage: "square.and.pencil") }
                }
                if let pinned = model.pinned {
                    Section("From the bench") { PostRow(post: pinned) }
                }
                Section {
                    if model.failed {
                        Text("Can't reach the Paddock right now.").foregroundStyle(.secondary)
                    } else if !model.loaded {
                        HStack { Spacer(); ProgressView(); Spacer() }
                    } else if model.posts.isEmpty {
                        Text("No posts yet. Start the trash talk.").foregroundStyle(.secondary)
                    }
                    ForEach(model.posts) { post in
                        PostRow(post: post).onAppear {
                            if post == model.posts.last { Task { await model.loadOlder() } }
                        }
                    }
                    if model.loadingOlder { HStack { Spacer(); ProgressView(); Spacer() } }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color("PageBackground"))
            .refreshable { await model.refresh() }
            .navigationTitle("The Paddock")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { composing = true } label: { Image(systemName: "square.and.pencil") }
                        .accessibilityLabel("Write a post")
                }
            }
            .sheet(isPresented: $composing) { ComposeView(model: model) }
        }
    }
}

struct PostRow: View {
    let post: PaddockPost

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(post.name).font(.subheadline.weight(.semibold))
                    .padding(.bottom, 1)
                    .overlay(alignment: .bottom) {
                        if let color = Competitor.color(post.name), post.role == "competitor" {
                            Rectangle().fill(color).frame(height: 2)
                        }
                    }
                if post.role == "judge" { Badge(text: "⚖️ Judge", fill: Color(red: 0x4a / 255, green: 0x15 / 255, blue: 0x26 / 255), ink: Color(red: 0xf4 / 255, green: 0xe9 / 255, blue: 0xdc / 255)) }
                if post.role == "competitor" { Badge(text: "🏇 Competitor", fill: Color(.systemGray5), ink: .secondary) }
                Spacer(minLength: 8)
                TimelineView(.periodic(from: .now, by: 30)) { context in
                    Text(Self.ago(post.date, now: context.date)).font(.caption).foregroundStyle(.secondary)
                }
            }
            Text(post.msg).font(.body).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    /// The page's style: 12s ago, 5m ago, 3h ago, 2d ago.
    static func ago(_ date: Date, now: Date) -> String {
        let s = max(0, Int((now.timeIntervalSince(date)).rounded()))
        if s < 60 { return "\(s)s ago" }
        let m = Int((Double(s) / 60).rounded())
        if m < 60 { return "\(m)m ago" }
        let h = Int((Double(m) / 60).rounded())
        if h < 48 { return "\(h)h ago" }
        return "\(Int((Double(h) / 24).rounded()))d ago"
    }
}

struct Badge: View {
    let text: String
    let fill: Color
    let ink: Color

    var body: some View {
        Text(text).font(.caption2.weight(.bold))
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(fill, in: Capsule())
            .foregroundStyle(ink)
    }
}

/// Each competitor's color on the standings page (its --series colors, light and dark).
enum Competitor {
    static func color(_ name: String) -> Color? {
        switch name {
        case "Jen": return dynamic(0x2a78d6, 0x3987e5)
        case "Kathy": return dynamic(0xeb6834, 0xd95926)
        case "Blas": return dynamic(0x1baf7a, 0x199e70)
        default: return nil
        }
    }

    private static func dynamic(_ light: Int, _ dark: Int) -> Color {
        func ui(_ hex: Int) -> UIColor {
            UIColor(red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255,
                    blue: CGFloat(hex & 0xff) / 255, alpha: 1)
        }
        return Color(UIColor { $0.userInterfaceStyle == .dark ? ui(dark) : ui(light) })
    }
}

struct ComposeView: View {
    @ObservedObject var model: PaddockModel
    @Environment(\.dismiss) private var dismiss
    @AppStorage("paddockName") private var savedName = ""
    @AppStorage("paddockCode") private var savedCode = ""
    @AppStorage("paddockRemember") private var remember = true
    @State private var name = ""
    @State private var message = ""
    @State private var passcode = ""
    @State private var problem: String?
    @State private var sending = false

    private var messageText: Binding<String> {
        Binding(get: { message }, set: { message = String($0.prefix(500)) })
    }

    var body: some View {
        NavigationStack {
            Form {
                // At the top, where the keyboard can't cover it.
                if let problem {
                    Section { Text(problem).foregroundStyle(.red) }
                }
                Section {
                    TextField("Keep it friendly-ish", text: messageText, axis: .vertical).lineLimit(3...10)
                } header: { Text("Message") } footer: { Text("\(message.count) / 500") }
                Section {
                    TextField("How you want to appear", text: $name).textContentType(.name)
                    SecureField("Passcode", text: $passcode)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    Toggle("Remember my name and passcode", isOn: $remember)
                } header: { Text("Your name and passcode") } footer: {
                    Text("Paul and the competitors: your own passcode signs the post with your name and badge.")
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Write a post")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if sending { ProgressView() } else { Button("Post", action: send).disabled(isBlank(message)) }
                }
            }
            .onAppear { name = savedName; passcode = savedCode }
        }
    }

    private func isBlank(_ s: String) -> Bool { s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private func send() {
        if isBlank(passcode) { problem = "Enter the passcode."; return }
        sending = true
        problem = nil
        Task {
            let trimmed = { (s: String) in s.trimmingCharacters(in: .whitespacesAndNewlines) }
            let error = await model.send(name: trimmed(name), message: trimmed(message), passcode: trimmed(passcode))
            sending = false
            if let error { problem = error; return }
            savedName = remember ? trimmed(name) : ""
            savedCode = remember ? trimmed(passcode) : ""
            dismiss()
        }
    }
}

#if DEBUG
/// Made-up posts for trying the Paddock tab: 75 of them, the judge's only post far enough back
/// that it is pinned from a page that hasn't loaded. Pages exactly the way the server does.
struct DemoPaddock: PaddockSource {
    private let all: [PaddockPost]

    init() {
        let now = Date()
        let names = ["Jen", "Kathy", "Blas"]
        all = (0..<75).map { i in
            let date = now.addingTimeInterval(Double(-i) * 420)
            let n = 75 - i
            let (name, role) = i == 50 ? ("Paul", "judge") : i % 7 == 3 ? (names[i % 3], "competitor") : ("Fan \(n)", "fan")
            let msg = role == "judge" ? "Demo ruling from the bench. Appeals are heard never." : "Demo post \(n). " + String(repeating: "Trash talk. ", count: i % 4)
            return PaddockPost(id: String(format: "demo%03d", n), iso: ISO8601DateFormatter().string(from: date),
                               date: date, name: name, role: role, msg: msg)
        }
    }

    func page(before: PaddockPost?) async throws -> PaddockPage {
        try? await Task.sleep(nanoseconds: 400_000_000)
        var start = 0
        if let before { while start < all.count && !PaddockPost.newestFirst(before, all[start]) { start += 1 } }
        let slice = Array(all[start..<min(start + 30, all.count)])
        return PaddockPage(posts: slice, hasMore: start + 30 < all.count,
                           pinned: before == nil ? all.first { $0.role == "judge" } : nil)
    }

    func send(name: String, message: String, passcode: String) async throws -> PaddockPost {
        throw PaddockError(message: "Demo mode: posting is off.")
    }
}
#endif
