import SwiftUI

// The Rules tab: the constitution, read from rules.md on the site so it can change without a new
// build of the app. The last copy fetched is kept for offline use, and the copy built into the app
// covers the first launch.

@MainActor
final class RulesModel: ObservableObject {
    @Published private(set) var blocks: [MarkdownBlock] = []

    private static var cacheFile: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("rules.md")
    }

    init() {
        let saved = (try? String(contentsOf: Self.cacheFile, encoding: .utf8))
            ?? Bundle.main.url(forResource: "rules", withExtension: "md").flatMap { try? String(contentsOf: $0, encoding: .utf8) }
            ?? ""
        blocks = MarkdownBlock.parse(saved)
    }

    func refresh() async {
        var request = URLRequest(url: Site.rulesURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.httpMethod = "GET"
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let text = String(data: data, encoding: .utf8), text.hasPrefix("#") else { return }
        try? data.write(to: Self.cacheFile, options: .atomic)
        blocks = MarkdownBlock.parse(text)
    }
}

/// The few kinds of Markdown the constitution uses: headings, paragraphs, tables, and rules.
struct MarkdownBlock: Identifiable {
    enum Kind {
        case heading(Int, String)
        case paragraph(String)
        case table([[String]])
        case rule
    }
    let id: Int
    let kind: Kind

    static func parse(_ text: String) -> [MarkdownBlock] {
        var kinds: [Kind] = []
        var paragraph: [String] = []
        var table: [[String]] = []
        func endParagraph() { if !paragraph.isEmpty { kinds.append(.paragraph(paragraph.joined(separator: " "))); paragraph = [] } }
        func endTable() { if !table.isEmpty { kinds.append(.table(table)); table = [] } }

        for raw in text.components(separatedBy: .newlines) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("|") {
                endParagraph()
                let cells = line.trimmingCharacters(in: CharacterSet(charactersIn: "|"))
                    .components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
                let divider = cells.allSatisfy { cell in !cell.isEmpty && cell.allSatisfy { "-: ".contains($0) } }
                if !divider { table.append(cells) }
                continue
            }
            endTable()
            if line.isEmpty { endParagraph(); continue }
            if line == "---" { endParagraph(); kinds.append(.rule); continue }
            let hashes = line.prefix { $0 == "#" }.count
            if hashes > 0, line.dropFirst(hashes).hasPrefix(" ") {
                endParagraph()
                kinds.append(.heading(hashes, String(line.dropFirst(hashes + 1))))
                continue
            }
            // A lettered item, "a) ...", stands on its own.
            if line.count > 2, line.first!.isLetter, line.dropFirst().hasPrefix(") ") {
                endParagraph()
                kinds.append(.paragraph(line))
                continue
            }
            paragraph.append(line)
        }
        endParagraph()
        endTable()
        return kinds.enumerated().map { MarkdownBlock(id: $0.offset, kind: $0.element) }
    }
}

struct RulesView: View {
    @ObservedObject var model: RulesModel

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(model.blocks) { block in view(for: block.kind) }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .frame(maxWidth: 720, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .background(Color("PageBackground"))
            .refreshable { await model.refresh() }
            .navigationTitle("Rules")
            .navigationBarTitleDisplayMode(.inline)
        }
        .task { await model.refresh() }
    }

    @ViewBuilder
    private func view(for kind: MarkdownBlock.Kind) -> some View {
        switch kind {
        case .heading(let level, let text):
            Text(inline(text))
                .font(level == 1 ? .title2.weight(.bold) : .headline)
                .padding(.top, level == 1 ? 4 : 10)
        case .paragraph(let text):
            Text(inline(text)).font(.body).fixedSize(horizontal: false, vertical: true)
        case .table(let rows):
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 6) {
                ForEach(rows.indices, id: \.self) { r in
                    GridRow {
                        ForEach(rows[r].indices, id: \.self) { c in
                            Text(inline(rows[r][c]))
                                .font(r == 0 ? .footnote.weight(.semibold) : .footnote)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    if r == 0 { Divider() }
                }
            }
            .padding(12)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
        case .rule:
            Divider().padding(.vertical, 6)
        }
    }

    /// Bold, italics, and links inside a line.
    private func inline(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
    }
}
