# Trellis Mobile

A local-first AI English learning app for Android, combining conversation practice, personalized review, and an on-device knowledge graph with SQLite and remote LLMs.

手机端重构的初始骨架。维护者：[frankz61](https://github.com/frankz61) · 15981955337@163.com。

## 当前范围

- React Native + TypeScript + Expo SDK 57，Android 优先。
- “今天 / 陪练 / 积累 / 我的”四个入口与真实空状态。
- SQLite 版本化迁移、稳定的本机 profile、会话/图谱/任务基础表与学习记录查询。
- 模型配置保存在 SQLite；API Key 通过系统安全存储保存，可替换或删除。
- 系统英语 TTS 试听和语速设置。语音识别尚未实现。
- “陪练”文字对话：OpenAI 兼容 `chat/completions` 流式请求（`expo/fetch`），用户消息先落库，回复按完成/中断/失败标记，冷启动恢复最近会话。
- 分层的业务服务、模型/语音接口与数据访问层，以及核心数据、SSE 解析与对话状态测试和 CI。

对话会把系统提示词和最近 20 条消息发送给你配置的服务商；除此之外不产生网络请求。知识抽取、出题、复习回写、任务执行、备份恢复和图谱展示属于后续里程碑；页面不会伪造已完成的学习记录。

## 开发

使用 Node.js 24 LTS、npm 和 Android Studio。需要 Android SDK 36、匹配的构建工具，以及兼容当前 Expo/Gradle 的 JDK；环境细节以本机原生构建结果为准。

```powershell
npm ci
npm run check
npm run android
```

`npm run android` 生成 Android 原生工程、构建并连接设备或模拟器。首次构建需要下载 Gradle 与原生依赖。若 Windows 没有设置 SDK 环境变量，可在当前终端设置默认安装路径：

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:ANDROID_HOME\platform-tools;$env:Path"
npm run android
```

已安装 development build 后：

```powershell
npm start
```

开发服务器运行时，从开发客户端连接 Metro。当前骨架面向原生环境，没有配置 Web 版本；iOS 尚未构建或验证。

其他命令：

| 命令 | 用途 |
|---|---|
| `npm run typecheck` | TypeScript 检查 |
| `npm test` | 真实 SQLite 内存库迁移/约束测试、设置服务故障测试 |
| `npm run export:android` | Metro Android JS 与资源打包检查，不等同 APK |
| `npm run prebuild:android` | 从 Expo 配置生成原生工程 |
| `npm run doctor` | Expo 项目依赖与配置诊断 |

原生目录通过 Expo prebuild 生成，不纳入版本控制；原生配置变更写入 app.json 或 config plugin。

## 项目标识

| 字段 | 值 |
|---|---|
| 仓库与 npm 包名 | `trellis-mobile` |
| App 显示名称 | `Trellis` |
| Android application ID | `com.frankz61.trellis` |
| Deep link scheme | `trellis` |
| 当前版本 | `0.1.0` |

Git 提交身份为本仓库的 local 配置，不改变其他仓库。GitHub 认证与 Expo/EAS 账号是独立配置；当前不设置未经确认的 Expo owner 或 EAS project ID。

## 架构与交接

```text
src/app                    启动与服务组装
src/screens                手机页面
src/components             共享界面与主题
src/domain                 不依赖原生运行时的领域类型与规则
src/application            业务用例
src/repositories           数据访问接口
src/contracts              远程模型与语音能力边界
src/prompts                版本化提示词
src/infrastructure         SQLite、系统安全存储、系统 TTS、OpenAI 兼容模型网关
tests                      数据与故障路径验证
docs                       重构设计、实施状态与下一步
```

- [手机端重构说明](docs/mobile-rebuild-guide.md)
- [实施状态与下一步](docs/implementation-status.md)

SQLite 当前没有启用 SQLCipher；Key 不进入数据库。Android 系统自动备份已关闭，自有导出恢复尚未实现，因此本阶段卸载 App 会失去本地学习数据。系统朗读是否联网取决于设备语音引擎，不宣称离线保证。

## License

MIT。保留了 Expo 模板的原始版权声明。
