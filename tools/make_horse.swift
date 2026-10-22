// Cuts the horse, rider, pole, and wine glass out of assets/horse-source.png.
// Run from the repo root:  swift tools/make_horse.swift
//
// Writes:
//   horse.png      the artwork as drawn (cream horse), for the dark theme
//   horse-ink.png  the cream parts inked in the background wine color, for the light theme
//
// How: the white corners outside the rounded square are flood-filled away, then the
// wine background is keyed out by color distance, with edge pixels un-mixed from the
// background so no wine-colored fringe is left. The result is cropped to the drawing.
import AppKit

let src = "assets/horse-source.png"
guard let img = NSImage(contentsOfFile: src),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("can't load \(src)"); exit(1)
}
let w = cg.width, h = cg.height
var px = [UInt8](repeating: 0, count: w * h * 4)
let space = CGColorSpaceCreateDeviceRGB()
let readCtx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                        space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
readCtx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))

let bg: [Double] = [0x4a, 0x15, 0x26]          // the wine background
let keyLow = 18.0, keyHigh = 90.0               // distance from bg: <= low is background, >= high is opaque
func rgb(_ i: Int) -> [Double] { [Double(px[i * 4]), Double(px[i * 4 + 1]), Double(px[i * 4 + 2])] }
func dist(_ a: [Double], _ b: [Double]) -> Double { sqrt(zip(a, b).map { ($0 - $1) * ($0 - $1) }.reduce(0, +)) }

// 1. The white corners: flood fill from each corner over near-white pixels, then widen by 3 px
//    to take the anti-aliased rim of the rounded square with it.
var outside = [Bool](repeating: false, count: w * h)
var stack = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
while let (x, y) = stack.popLast() {
    if x < 0 || y < 0 || x >= w || y >= h { continue }
    let i = y * w + x
    if outside[i] || dist(rgb(i), [255, 255, 255]) > 60 { continue }
    outside[i] = true
    stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
}
var rim = outside
for _ in 0..<3 {
    var grown = rim
    for y in 0..<h { for x in 0..<w where rim[y * w + x] {
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let nx = x + dx, ny = y + dy
            if nx >= 0, ny >= 0, nx < w, ny < h { grown[ny * w + nx] = true }
        }
    } }
    rim = grown
}

// 2. Key out the background and un-mix the edges.
var color = [[Double]](repeating: [0, 0, 0], count: w * h)
var alpha = [Double](repeating: 0, count: w * h)
for i in 0..<(w * h) where !rim[i] {
    let p = rgb(i)
    let a = min(1, max(0, (dist(p, bg) - keyLow) / (keyHigh - keyLow)))
    if a <= 0 { continue }
    alpha[i] = a
    color[i] = (0..<3).map { c in min(255, max(0, (p[c] - (1 - a) * bg[c]) / a)) }
}

// 3. Crop to the drawing, with 2 px to spare.
var minX = w, minY = h, maxX = -1, maxY = -1
for y in 0..<h { for x in 0..<w where alpha[y * w + x] > 0.02 {
    minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
} }
minX = max(0, minX - 2); minY = max(0, minY - 2); maxX = min(w - 1, maxX + 2); maxY = min(h - 1, maxY + 2)
let cw = maxX - minX + 1, ch = maxY - minY + 1
print("source \(w)x\(h), drawing \(cw)x\(ch) at (\(minX),\(minY))")

// How cream a color is, 0 to 1. Cream is light and nearly unsaturated; the gold rider, the red
// wine, and the pink speed lines are not. Graded, so anti-aliased edges ink smoothly.
func creaminess(_ c: [Double]) -> Double {
    let lo = c.min() ?? 0, spread = (c.max() ?? 0) - lo
    let light = min(1, max(0, (lo - 110) / 60))
    let neutral = min(1, max(0, (95 - spread) / 25))
    return light * neutral
}

func write(_ name: String, ink: Bool) {
    var out = [UInt8](repeating: 0, count: cw * ch * 4)
    var inked = 0
    for y in 0..<ch { for x in 0..<cw {
        let i = (y + minY) * w + (x + minX)
        let a = alpha[i]
        if a <= 0 { continue }
        var c = color[i]
        if ink {
            let k = creaminess(c)
            if k > 0 { c = (0..<3).map { c[$0] * (1 - k) + bg[$0] * k }; inked += 1 }
        }
        let o = (y * cw + x) * 4
        for k in 0..<3 { out[o + k] = UInt8((c[k] * a).rounded()) }   // premultiplied
        out[o + 3] = UInt8((a * 255).rounded())
    } }
    let ctx = CGContext(data: &out, width: cw, height: ch, bitsPerComponent: 8, bytesPerRow: cw * 4,
                        space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: name))
    print("wrote \(name)" + (ink ? " (\(inked) cream pixels inked)" : ""))
}
write("horse.png", ink: false)
write("horse-ink.png", ink: true)
