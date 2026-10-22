// Renders the app icons: a racing-green square with the horse-racing emoji.
// Run from the repo root:  swift tools/make_icons.swift
import AppKit

let outputs: [(String, Int)] = [("apple-touch-icon.png", 180), ("icon-192.png", 192), ("icon-512.png", 512)]
let green = NSColor(red: 0.059, green: 0.318, blue: 0.196, alpha: 1) // #0f5132

for (name, px) in outputs {
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
                                     samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                     colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { continue }
    rep.size = NSSize(width: px, height: px)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let s = CGFloat(px)
    green.setFill()
    NSRect(x: 0, y: 0, width: s, height: s).fill()
    let text = NSAttributedString(string: "🏇", attributes: [.font: NSFont.systemFont(ofSize: s * 0.62)])
    let size = text.size()
    text.draw(at: NSPoint(x: (s - size.width) / 2, y: (s - size.height) / 2 + s * 0.02))
    NSGraphicsContext.restoreGraphicsState()
    if let png = rep.representation(using: .png, properties: [:]) {
        try? png.write(to: URL(fileURLWithPath: name))
        print("wrote \(name)")
    }
}
