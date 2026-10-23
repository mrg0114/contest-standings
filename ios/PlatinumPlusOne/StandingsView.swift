import SwiftUI
import WebKit
import OneSignalFramework

struct ContentView: View {
    @StateObject private var page = PageController()

    var body: some View {
        ZStack {
            Color("PageBackground").ignoresSafeArea()
            // The page pads its own bottom for the home indicator, so the web view runs to the bottom edge.
            WebViewHost(webView: page.webView).ignoresSafeArea(.container, edges: .bottom)
            if page.offline { OfflineView(retry: page.reload) }
        }
    }
}

struct WebViewHost: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

struct OfflineView: View {
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.slash").font(.largeTitle).foregroundStyle(.secondary)
            Text("Can't reach the standings").font(.headline)
            Text("Check your connection and try again.").font(.subheadline).foregroundStyle(.secondary)
            Button("Try again", action: retry).buttonStyle(.borderedProminent).padding(.top, 4)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color("PageBackground"))
    }
}

/// Owns the web view: loads the site, keeps other links in Safari, shows the offline screen,
/// and answers the page's bell (the "plusOne" message handler).
final class PageController: NSObject, ObservableObject {
    @Published var offline = false
    let webView: WKWebView
    private var askedForPush = false

    override init() {
        let config = WKWebViewConfiguration()
        // The page looks for "PlatinumPlusOneApp/" to know it is inside the app.
        config.applicationNameForUserAgent = "Mobile/15E148 PlatinumPlusOneApp/\(Site.version)"
        let messages = WKUserContentController()
        config.userContentController = messages
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()

        messages.add(WeakMessageHandler(self), name: "plusOne")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        let background = UIColor(named: "PageBackground")
        webView.isOpaque = false
        webView.backgroundColor = background
        webView.scrollView.backgroundColor = background
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        let refresh = UIRefreshControl()
        refresh.addTarget(self, action: #selector(pulledToRefresh), for: .valueChanged)
        webView.scrollView.refreshControl = refresh
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif

        OneSignal.User.pushSubscription.addObserver(self)
        OneSignal.Notifications.addPermissionObserver(self)
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(openFromNotification(_:)), name: .plusOneOpen, object: nil)
        center.addObserver(self, selector: #selector(cameToForeground),
                           name: UIApplication.willEnterForegroundNotification, object: nil)
        webView.load(URLRequest(url: Site.url))
    }

    func reload() {
        offline = false
        if webView.url == nil { webView.load(URLRequest(url: Site.url)) } else { webView.reload() }
    }

    @objc private func pulledToRefresh() { reload() }

    @objc private func openFromNotification(_ note: Notification) {
        if let link = note.object as? URL, Site.isOwn(link) {
            webView.load(URLRequest(url: link))
        } else {
            reload()
        }
    }

    @objc private func cameToForeground() { reportPushState() }

    /// Tells the page's bell whether notifications are on.
    private func reportPushState() {
        let state = Push.isOn ? "on" : "off"
        DispatchQueue.main.async {
            self.webView.evaluateJavaScript("window.plusOneApp && window.plusOneApp.pushState('\(state)')")
        }
    }
}

extension PageController: WKNavigationDelegate, WKUIDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let link = action.request.url else { return decisionHandler(.allow) }
        // A nil target frame is a link that wants a new window (target="_blank").
        let mainFrame = action.targetFrame?.isMainFrame ?? true
        let web = link.scheme == "http" || link.scheme == "https"
        if mainFrame && (!web || !Site.isOwn(link)) && link.scheme != "about" {
            UIApplication.shared.open(link)
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    /// A new-window link to the site itself opens in place.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.targetFrame == nil { webView.load(action.request) }
        return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        offline = false
        webView.scrollView.refreshControl?.endRefreshing()
        reportPushState()
        if !askedForPush {
            askedForPush = true
            Push.askOnce()
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        loadFailed(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        loadFailed(error)
    }

    private func loadFailed(_ error: Error) {
        webView.scrollView.refreshControl?.endRefreshing()
        if (error as NSError).code == NSURLErrorCancelled { return }
        offline = true
    }

    /// The page's alert() and confirm() as native dialogs (the bell uses alert for problems).
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        guard let top = Self.topController() else { return completionHandler() }
        top.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        guard let top = Self.topController() else { return completionHandler(false) }
        top.present(alert, animated: true)
    }

    private static func topController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes.first { $0.activationState == .foregroundActive } as? UIWindowScene
        var top = scene?.keyWindow?.rootViewController
        while let next = top?.presentedViewController { top = next }
        return top
    }
}

extension PageController: WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let from = message.frameInfo.request.url, Site.isOwn(from),
              let body = message.body as? [String: Any], let action = body["action"] as? String else { return }
        switch action {
        case "togglePush": Push.toggle { [weak self] in self?.reportPushState() }
        case "pushState": reportPushState()
        default: break
        }
    }
}

extension PageController: OSPushSubscriptionObserver, OSNotificationPermissionObserver {
    func onPushSubscriptionDidChange(state: OSPushSubscriptionChangedState) { reportPushState() }
    func onNotificationPermissionDidChange(_ permission: Bool) { reportPushState() }
}

/// WKUserContentController holds its handlers strongly; this keeps it from holding the page controller.
final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
