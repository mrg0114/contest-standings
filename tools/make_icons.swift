// Renders the app icons: the horse artwork (horse.png) on its wine background, full bleed.
// iOS and Android round the corners themselves, so the square is drawn edge to edge.
// Run from the repo root, after tools/make_horse.swift:  swift tools/make_icons.swift
import AppKit

let outputs: [(String, Int)] = [("apple-touch-icon.png", 180), ("icon-192.png", 192), ("icon-512.png", 512)]
let wine = NSColor(red: 0x4a / 255.0, green: 0x15 / 255.0, blue: 0x26 / 255.0, alpha: 1) // #4a1526, the source background
guard let art = NSImage(contentsOfFile: "horse.png") else { print("run tools/make_horse.swift first"); exit(1) }
let artW = art.size.width, artH = art.size.height

for (name, px) in outputs {
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
                                     samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                     colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { continue }
    rep.size = NSSize(width: px, height: px)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSGraphicsContext.current?.imageInterpolation = .high
    let s = CGFloat(px)
    wine.setFill()
    NSRect(x: 0, y: 0, width: s, height: s).fill()
    // The drawing fills 86% of the width, centered, which keeps the pole tip clear of the rounded corners.
    let dw = s * 0.86, dh = dw * artH / artW
    art.draw(in: NSRect(x: (s - dw) / 2, y: (s - dh) / 2, width: dw, height: dh))
    NSGraphicsContext.restoreGraphicsState()
    if let png = rep.representation(using: .png, properties: [:]) {
        try? png.write(to: URL(fileURLWithPath: name))
        print("wrote \(name)")
    }
}
