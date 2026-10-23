// Platinum +1 Club - the iPhone app.
// Four tabs: Standings (the standings page in a web view), the Paddock (native, on the same message
// board as the website), Rules (the constitution, from rules.md on the site), and Donate.
// Notifications are native, through OneSignal, which the page can't do reliably on iPhone
// (web push needs a Home Screen icon, iOS 16.4, and no blocker).

import SwiftUI
import OneSignalFramework

@main
struct PlatinumPlusOneApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup { RootView() }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        OneSignal.initialize(Site.oneSignalAppId, withLaunchOptions: launchOptions)
        OneSignal.Notifications.addClickListener(NotificationClicks.shared)
        return true
    }
}

/// Where the app points. Debug builds load the test site and Release builds the live site
/// (SITE_URL in the build settings, passed through Info.plist as PlusOneSiteURL).
enum Site {
    static let url: URL = {
        let s = Bundle.main.object(forInfoDictionaryKey: "PlusOneSiteURL") as? String ?? ""
        return URL(string: s) ?? URL(string: "https://mrg0114.github.io/contest-standings/")!
    }()

    /// The same OneSignal app as the website, so the scoring script's notifications reach both.
    static let oneSignalAppId = "2c15edd1-bd5b-4f74-b3e7-64b1f7cd4c43"

    /// The Paddock's Apps Script web app, the one config.js gives the website.
    static let paddockURL = URL(string: "https://script.google.com/macros/s/AKfycbzRKQOBp7NW8QJ9ZmoKo5GuqRlNeQ7rSWSLazq4bTz6qQnmT7QAyEfUqYi8BhNHHluUNg/exec")!

    /// The rules as published on the site. Edit rules.md in the repo and the Rules tab follows.
    static var rulesURL: URL { url.appendingPathComponent("rules.md") }

    static var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
    }

    /// Is this address part of the standings site? Anything else opens in Safari.
    static func isOwn(_ other: URL) -> Bool {
        let base = url.path.hasSuffix("/") ? String(url.path.dropLast()) : url.path
        return other.host == url.host && (other.path == base || other.path.hasPrefix(base + "/"))
    }
}

/// Notifications: whether they're on, and turning them on or off from the page's bell.
enum Push {
    static var isOn: Bool { OneSignal.Notifications.permission && OneSignal.User.pushSubscription.optedIn }

    /// Off if on. Otherwise asks iOS (or opens Settings if it was refused before) and opts in.
    static func toggle(_ done: @escaping () -> Void) {
        if isOn {
            OneSignal.User.pushSubscription.optOut()
            done()
            return
        }
        OneSignal.Notifications.requestPermission({ accepted in
            if accepted { OneSignal.User.pushSubscription.optIn() }
            DispatchQueue.main.async(execute: done)
        }, fallbackToSettings: true)
    }

    /// The first time the page loads, asks once. iOS shows its prompt only if it never has.
    static func askOnce() {
        guard OneSignal.Notifications.canRequestPermission else { return }
        OneSignal.Notifications.requestPermission({ _ in }, fallbackToSettings: false)
    }
}

extension Notification.Name {
    /// Posted when someone taps a notification; the object is the notification's link, if any.
    static let plusOneOpen = Notification.Name("plusOneOpen")
}

/// A tapped notification opens the app on its link. OneSignal_suppress_launch_urls in Info.plist
/// keeps OneSignal from sending the link to Safari instead.
final class NotificationClicks: NSObject, OSNotificationClickListener {
    static let shared = NotificationClicks()

    func onClick(event: OSNotificationClickEvent) {
        let link = event.result.url.flatMap { URL(string: $0) }
        DispatchQueue.main.async { NotificationCenter.default.post(name: .plusOneOpen, object: link) }
    }
}
