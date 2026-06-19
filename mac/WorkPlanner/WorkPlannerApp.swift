import SwiftUI

@main
struct WorkPlannerApp: App {
    @StateObject private var controller = WebController()

    var body: some Scene {
        WindowGroup("工作规划") {
            ContentView(controller: controller)
        }
        .defaultSize(width: 1240, height: 840)
        .commands {
            // Inject backup/data commands into the standard File menu.
            CommandGroup(after: .saveItem) {
                Divider()
                Button("导出备份…") { controller.exportBackup() }
                    .keyboardShortcut("e", modifiers: [.command, .shift])
                Button("导入备份…") { controller.importBackup() }
                    .keyboardShortcut("i", modifiers: [.command, .shift])
                Divider()
                Button("在访达中显示数据文件") { controller.revealData() }
                    .keyboardShortcut("r", modifiers: [.command, .shift])
                Button("从磁盘重新载入") { controller.reloadFromDisk() }
            }
        }
    }
}
