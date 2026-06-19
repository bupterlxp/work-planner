import Foundation

/// File-based persistence. The data file is the single source of truth;
/// the web app's `localStorage["work-planner.v2"]` is mirrored here on every save.
enum Store {
    static let storageKey = "work-planner.v2"

    private static var fm: FileManager { .default }

    /// ~/Library/Application Support/WorkPlanner/
    static var directory: URL {
        let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support")
        let dir = base.appendingPathComponent("WorkPlanner", isDirectory: true)
        if !fm.fileExists(atPath: dir.path) {
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    static var dataFile: URL { directory.appendingPathComponent("data.json") }

    /// Current persisted JSON string, or nil if there is nothing yet.
    static func read() -> String? {
        guard let data = try? Data(contentsOf: dataFile),
              let s = String(data: data, encoding: .utf8),
              !s.isEmpty else { return nil }
        return s
    }

    /// Persist the full state JSON atomically.
    static func write(_ json: String) {
        guard let data = json.data(using: .utf8) else { return }
        try? data.write(to: dataFile, options: .atomic)
    }

    /// Overwrite the data file from a user-chosen backup (validates it is JSON).
    static func importFrom(_ url: URL) throws {
        let data = try Data(contentsOf: url)
        _ = try JSONSerialization.jsonObject(with: data) // throws if not valid JSON
        try data.write(to: dataFile, options: .atomic)
    }

    /// Copy the current data file to a user-chosen location.
    static func exportTo(_ url: URL) throws {
        let data = (try? Data(contentsOf: dataFile)) ?? Data("{}".utf8)
        try data.write(to: url, options: .atomic)
    }
}
