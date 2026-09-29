# 实施状态

## 本次决策

- 采用 React Native + TypeScript + Expo SDK 57 development build。
- Android 优先；显示名称 Trellis，仓库名称 trellis-mobile。
- Android application ID 为 com.frankz61.trellis。
- 本地单用户，SQLite 同时存业务数据和图谱关系。
- 用户自行提供远程模型 Key；本次只保存配置，不执行模型请求。
- 系统 TTS 使用 expo-speech，系统识别使用 expo-speech-recognition；在线 STT/TTS（OpenAI 兼容音频接口）可在“我的”页逐项切换，默认仍为系统引擎（2026-09-29）。
- 不嵌入 Python、FastAPI 或 LangGraph，不创建远程业务服务器。

## 已实现

- 四入口页面、主题、启动状态、数据库失败重试与 Android 返回键回到首页。
- SQLite v1 迁移、基础图谱与学习记录表、稳定的本机 profile。
- 积累与统计读取真实数据库；无样例学习数据。
- 模型地址/模型名/温度（可选，留空不发送）保存，HTTPS 地址校验，系统安全存储 Key。
- 密钥替换先写新条目再切换数据库引用，数据库失败时回滚新密钥。
- 系统英语声音检查、试听、停止；切后台时停止朗读。
- 模型协议：OpenAI 兼容 `POST {baseUrl}/chat/completions`，`stream: true`，通过 `expo/fetch` 读取 SSE；解析器跨 chunk/跨多字节字符安全；兼容不流式的 JSON 应答；错误分为网络/鉴权/HTTP/协议并给出中文提示。
- 文字对话（2026-09-21）：用户消息先写入 `messages` 再发请求；回复以 `pending` 插入、流式期间每 500 ms 回写、结束标记 `complete`，停止标记 `interrupted` 并保留部分内容，出错标记 `failed`；启动时把遗留 `pending` 标为 `interrupted`；上下文为版本化提示词 `coach-v1` + 最近 20 条有效消息。
- 语音识别：系统识别（边说边出字，点“停止”保留已识别内容）或在线识别（expo-audio 录 16 kHz 单声道 AAC，最长 60 秒，点“停止”后上传 `POST {baseUrl}/audio/transcriptions`，上传上限 10 MB，录音文件用后删除）。
- 英语朗读：系统声音或在线朗读（`POST {baseUrl}/audio/speech`，格式 mp3/aac/opus/wav/flac，按句分段、每段最多 2000 字符，逐段下载播放；语速由播放器带音高校正实现）。
- 语音设置（2026-09-29，迁移 v3）：识别与朗读各自保存引擎、地址、模型（朗读另有声音、格式、语速）。Key 可单独保存（`trellis.stt.*` / `trellis.tts.*`），留空时仅在与 AI 模型同一主机（scheme+host+port）时共用模型 Key；更换主机即丢弃原 Key，不会把 Key 发往未为其填写的主机。引擎按每次调用时的已保存设置选择，切换无需重启；在线配置不完整时如实提示，不回退、不伪造结果。
- 知识图谱视图（2026-09-29）：“积累”页可在列表与图谱间切换。节点为语法薄弱点（大小/颜色随薄弱次数）、单词（颜色随掌握度）、用户说过的句子；边为“单词出现在句子”“句子中的错误属于语法点”，均来自真实抽取记录并按 profile 过滤。总览最多 36 个节点（语法点优先、再按连接数选词与相连句子），点节点看详情，可“以它为中心”展开两跳邻域。使用 react-native-svg 绘制，确定性力导向布局；点击由画布统一按最近节点判定（SVG 元素自身的点击判定在 Android 上不可靠）。单词之间的同义/反义/搭配关系表尚无写入来源，图中暂不显示。
- 类型检查、迁移/数据约束/密钥失败路径/SSE 解析/模型网关/对话状态测试，以及 GitHub Actions 检查。

## 下一阶段

1. 迁移并版本化知识抽取提示词，增加模型 JSON 运行时校验与抽取任务执行（任务表已就位）。
2. 将抽取结果按来源消息幂等写入图谱，真正打通薄弱点上下文。
3. 通过新增迁移补充 daily_plans、exercises、review_attempts，再做每日练习与掌握度回写。
4. ~~接入 Android SpeechRecognizer~~ 已接入；在线识别/朗读已接入。后续可加“测试连接”按钮与识别结果置信度提示。
5. 会话管理：新建/切换会话、上下文长度控制（当前只恢复最近一个会话，固定最近 20 条）。
6. 实现一致性导出恢复，再准备面向真实用户的安装包。

任务表仅预留持久化结构，尚未运行 worker；掌握度表尚未实现评分规则。对话已经是真实模型请求，但还不是带抽取与复习闭环的 Agent。离开“陪练”页会中止进行中的请求并标记为中断。

## 迁移基线

旧项目：Trellis Web。

源码基线 commit：`a3fdff539ec554fba05bf0dfa59938d26550910f`。

本机旧仓库位于新仓库的相邻目录 `../Trellis`。优先参考其中 `backend/app/agent`、`backend/app/prompts`、`backend/app/kg/queries.py`；不复制原型的占位题、失败后伪成功或非原子掌握度更新行为。

## 设备验收待办

- ~~真实 Android 设备安装与冷启动，SQLite 配置重启恢复。~~ 2026-09-21 在 OnePlus PLQ110（Android 16）通过，见下方"真机验证"。
- 系统安全存储保存、替换、删除 Key 已在真机通过；"模型请求接入前不产生网络调用"尚未用抓包验证。
- 无英语声音的系统朗读提示已在真机通过（OPPO 引擎只有中文声音）；有英语声音的朗读、停止、耳机切换和来电场景仍待在装有英语 TTS 的设备上验证。
- 数据库损坏或未来版本提示；需要完善数据库错误分类。
- 当前 expo-speech 适配器不暴露每个声音的联网属性，UI 明确提示由引擎决定。
- 断进程时可能留下未引用的安全存储条目，后续增加可追踪的清理策略。
- ~~语速目前和模型配置一起保存~~ 2026-09-29 起随“英语朗读”设置保存。
- 在线识别的真机录音→转写全链路待用户实际说话验证；在线朗读已在真机验证（见下）。

## 本次验证

- TypeScript 应用与测试代码检查通过。
- 9 项自动测试通过：数据库初始化/重开、未来版本拒绝、迁移回滚、图关系与任务去重、配置校验、密钥保存与故障恢复。
- Expo doctor 21/21 项检查通过。
- Android Metro JS/资源导出通过；Android 原生工程可通过 prebuild 生成。
- 原生 debug 构建（`:app:assembleDebug`）通过：Gradle 9.3.1，首次约 13 分钟，产物 `android/app/build/outputs/apk/debug/app-debug.apk`（约 178 MB）。本机存在 Android SDK 36，需设置 ANDROID_HOME 后使用。
- 真机功能仍按上方清单验收，不将 JS 打包成功等同于原生运行成功。

## 真机验证（2026-09-21）

设备：OnePlus PLQ110（一加 Ace 6），Android 16 / API 36，arm64，1272×2800 @ 560dpi，ColorOS。通过无线调试安装 debug 包并连接 Metro。

通过项：

- 冷启动、四个 Tab 切换、积累与统计的真实空状态。
- 设置校验：`http://` 地址被拒绝并显示中文提示；`https://api.example.com/v1/` 保存后归一化为 `https://api.example.com/v1`。
- 保存后 SQLite `settings` 行只含 `credential_ref`（`trellis.model.<uuid>`），三个数据库文件中均无 Key 明文；SecureStore 条目为 Keystore AES 密文。
- 强杀进程后冷启动，设置与"已保存"状态恢复；profile ID 跨启动稳定。
- 删除 Key：确认框、SecureStore 清空、`credential_ref` 置空、地址与模型保留。
- 系统朗读：设备只有 OPPO 中文声音时，试听显示"设备没有可用的英语声音"，不伪装成功；安装 Google TTS 并设为首选引擎后，绑定 `com.google.android.tts`、请求 `en-US` 本地声音，朗读约 4 秒并正常回调 `onDone`（试听按钮在朗读期间变为"停止朗读"）。
- Android 返回键：非首页回到"今天"，首页退到桌面。
- 文字对话（用户自有 OpenAI 兼容端点，带端口的 HTTPS 地址）：发送后用户气泡与"…"占位立即出现、按钮变"停止"；回复为英文、2–4 句并追问，符合 `coach-v1`；`messages` 表两条 `complete`，会话标题取自首条消息。传输诊断：`text/event-stream`，27 个数据块，首 token 约 2.6 s、4.7 s 结束，确认 `expo/fetch` 为增量交付。首 token 前点"停止"得到空内容的 `interrupted` 回复，UI 显示"（没有收到回复内容）· 回复已中断"。强杀后冷启动完整恢复历史，"今天"页对话计数为 1。

顺手修复：设置页页脚 `\n` 未换行（JSX 属性字符串不转义）；语速按钮 `0.85× ✓` 在 560dpi 设备上折行，改为选中态填充并通过 `accessibilityState.selected` 暴露。

调试环境备注：

- Android Emulator 36.2.12 与 android-36.1 google_apis_playstore x86_64 镜像在本机（WHPX）不兼容：guest 的 `mapper.ranchu.so` 断言 `hasReadColorBufferDma` 反复崩溃，导致 surfaceflinger/system_server 循环重启；升级到 37.1.11 后宿主不再段错误但 guest 断言仍在。模拟器测试需要更换系统镜像或换加速器，当前以真机为准。
- ColorOS 下 adb 需注意：`adb install` 报 `Failure [-99]` 时改为先 `adb push` 再 `pm install`；密码输入框获焦时截屏为黑屏；`uiautomator dump` 可能被系统杀掉；中文输入法会改写 `adb shell input text` 的内容。
- debug 包的 expo-dev-menu 在无输入法时把按键 `R`/`P`/`I` 当作快捷键，自动化输入前需关闭 dev-menu 的 key commands。

## 真机验证（2026-09-29，release 包）

设备同上，通过无线调试（`adb connect <IP>:<port>`，本机 mDNS 发现失败时直接连接）安装 arm64 release 包（约 31 MB，JS 内置，不依赖 Metro），覆盖安装保留全部数据。

- 冷启动约 0.2–0.5 s；v2→v3 迁移在真机上完成，模型配置、学习记录与语速保留。
- 修复：Android 16 强制 edge-to-edge 后 `adjustResize` 失效，键盘遮挡“陪练”输入栏；`KeyboardAvoidingView` 在 Android 也使用 `padding`。
- 修复：进入“陪练”未定位到最新消息；改为在 `onContentSizeChange`/`onLayout` 后延一帧 `scrollToEnd`（Fabric 下回调内直接滚动无效）。
- 系统识别报“系统语音识别服务不可用”的原因是 Google 语音服务（`com.google.android.tts`）自身没有麦克风权限（日志 `MICROPHONE_UNAVAILABLE`，回传 `ERROR_INSUFFICIENT_PERMISSIONS`）；用户在系统设置中授权后识别正常。
- 在线朗读：用户自有 OpenAI 兼容端点（与模型同一主机、共用模型 Key），`deepgram/aura-asteria-en` + `asteria` + mp3，试听请求成功，ExoPlayer 解码 `audio/mpeg` 并完整播放约 5 s。
- 修复：保存一张语音设置卡片会重置另一张卡片未保存的修改。
- expo-audio 插件关闭后台播放（`enableBackgroundPlayback: false`），不申请前台服务权限；切后台时朗读停止。
- 知识图谱：真机上以真实数据（3 个语法点、3 个单词、2 个句子）渲染；点击节点高亮邻边并显示详情，“以它为中心/回到总览”正常。
