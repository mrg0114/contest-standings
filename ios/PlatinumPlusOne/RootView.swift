import SwiftUI

/// The tab bar. The Paddock refreshes every minute while the app is open, and its tab shows how many
/// posts arrived since you last looked.
struct RootView: View {
    enum Tab: Hashable { case standings, paddock, rules, donate }

    @State private var tab: Tab = .standings
    @StateObject private var page = PageController()
    @StateObject private var paddock = PaddockModel()
    @StateObject private var rules = RulesModel()
    @Environment(\.scenePhase) private var phase

    var body: some View {
        TabView(selection: selection) {
            StandingsView(page: page)
                .tabItem { Label("Standings", systemImage: "flag.checkered") }
                .tag(Tab.standings)
            PaddockView(model: paddock)
                .tabItem { Label("Paddock", systemImage: "bubble.left.and.bubble.right") }
                .badge(paddock.unseen)
                .tag(Tab.paddock)
            RulesView(model: rules)
                .tabItem { Label("Rules", systemImage: "scroll") }
                .tag(Tab.rules)
            if Site.showDonateTab {
                DonateView()
                    .tabItem { Label("Donate", systemImage: "heart") }
                    .tag(Tab.donate)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .plusOneOpen)) { _ in tab = .standings }
        .task(id: phase) {
            guard phase == .active else { return }
            while !Task.isCancelled {
                await paddock.refresh()
                try? await Task.sleep(nanoseconds: 60 * 1_000_000_000)
            }
        }
    }

    /// Switching tabs also tells the Paddock whether it is on screen, which clears its badge.
    private var selection: Binding<Tab> {
        Binding(get: { tab }, set: { tab = $0; paddock.isViewing = $0 == .paddock })
    }
}
