---
date: 2026-06-11
topic: voicebox-audiobook
---

# Voicebox 有声读物生成需求

## Summary

在全文预览下新增「有声读物」栏，把已成稿章节通过本机 Voicebox 服务生成章节音频。系统读取 Voicebox 现有音色 profile，作品内为旁白和角色绑定声音，并由 Story Matrix AI 基于角色设定与章节上下文生成语音合成提示词。

---

## Problem Frame

Story Matrix AI 当前覆盖从灵感、世界观、角色、大纲到章节成稿的文字创作链路，但成稿后的输出仍以文本预览和 TXT/Markdown 下载为主。用户现在没有实际的有声读物制作流程，因此首版不是替换旧工具，而是在成稿后验证「多角色小说可稳定转成可听章节」这件事是否成立。

这类功能的主要风险不在单次 TTS 调用，而在长篇小说的流程稳定性：角色声音需要和设定一致，旁白与台词需要被正确切分，生成失败要可恢复，用户需要能在生成前修正 AI 误判。首版应优先打通可靠闭环，而不是追求一次生成可发布整本成品。

---

## Actors

- A1. 作者：在作品成稿后配置旁白/角色声音，检查切分结果，生成章节音频。
- A2. Story Matrix AI：理解作品角色设定、章节上下文和场景情绪，生成分段脚本与语音合成提示词。
- A3. Voicebox：提供本机 voice profiles、TTS 引擎、生成状态和音频文件。

---

## Key Flows

- F1. 系统连接 Voicebox
  - **Trigger:** 用户进入系统语音合成配置页。
  - **Actors:** A1, A3
  - **Steps:** 配置 Voicebox 服务地址；检查服务健康状态；读取可用 voice profiles、模型状态和默认合成参数；保存系统级默认值。
  - **Outcome:** 后续作品可直接读取 Voicebox 音色并发起生成。
  - **Covered by:** R1, R2, R3

- F2. 配置作品有声读物声音
  - **Trigger:** 用户在全文预览下打开「有声读物」栏。
  - **Actors:** A1, A2, A3
  - **Steps:** 系统列出旁白和作品角色；从 Voicebox profiles 中选择绑定音色；Story Matrix AI 根据角色设定生成音色描述和基础语音合成提示词；用户可编辑并保存作品级配置。
  - **Outcome:** 每个需要发声的 speaker 都有可复用的声音绑定和合成提示词。
  - **Covered by:** R4, R5, R6, R7

- F3. 生成章节有声读物
  - **Trigger:** 用户选择一个已成稿章节并发起有声读物生成。
  - **Actors:** A1, A2, A3
  - **Steps:** Story Matrix AI 将章节正文自动切分为旁白/角色分段；用户在分段表中修正 speaker、文本、上下文或语气提示；系统按分段调用 Voicebox 生成音频；章节完成后提供试听和下载。
  - **Outcome:** 该章节拥有可试听、可下载、可重生成的章节音频。
  - **Covered by:** R8, R9, R10, R11, R12, R13

---

## Requirements

**系统级 Voicebox 配置**
- R1. 系统必须提供语音合成配置页面，用于配置 Voicebox 服务地址，默认指向本机服务。
- R2. 系统必须通过 Voicebox 本机 OpenAPI 暴露的接口检查服务可用性，接口字段和路径以 `http://127.0.0.1:17493/docs` / `openapi.json` 为准，不凭 README 或外部摘要推断。
- R3. 系统必须读取 Voicebox 现有 voice profiles 供用户绑定，不在 Story Matrix AI 内上传、保存或维护参考音频目录。

**作品级声音配置**
- R4. 「有声读物」必须位于全文预览下，定位为成稿后的增强导出能力，不插入章节写作流程。
- R5. 作品级配置必须包含旁白和每个作品角色的声音绑定状态，未绑定的 speaker 不应静默参与生成。
- R6. 系统必须能基于角色设定、角色标签、人物关系和作品基调，为角色生成可编辑的音色描述。
- R7. 系统必须能为旁白和角色生成可编辑的基础语音合成提示词；该提示词由 Story Matrix AI 维护，并优先用于 Voicebox 的合成指令，而不是依赖 Voicebox 内置 personality prompt。

**章节切分与修正**
- R8. 用户发起章节生成前，系统必须先用 AI 将章节正文切分为分段脚本，至少区分旁白和角色台词。
- R9. 每个分段必须包含 speaker、文本、用于合成的上下文/情绪信息，以及最终会发送给 Voicebox 的语音合成提示词。
- R10. 分段脚本必须在生成音频前展示给用户，并允许用户编辑 speaker、文本和语音合成提示词。
- R11. 系统必须支持用户重新运行章节切分，同时保留用户能判断是否覆盖已有编辑的机会。

**章节音频生成**
- R12. 首版必须按章节生成音频，生成失败时只影响当前章节，不阻塞其他章节继续尝试。
- R13. 章节生成过程必须展示稳定的任务状态，包括待生成、生成中、完成、失败，并提供失败原因或可执行的重试入口。
- R14. 章节音频完成后，用户必须能在「有声读物」栏试听并下载章节音频。
- R15. 首版必须以流程稳定为第一成功标准，不要求产物达到可直接发布的有声书成品质量。

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given Voicebox 正在本机运行，when 用户打开语音合成配置页并点击检查连接，then 系统显示服务可用并列出 Voicebox profiles。
- AE2. **Covers R5, R12.** Given 某个主要角色没有绑定 voice profile，when 用户尝试生成包含该角色台词的章节，then 系统阻止生成并提示先补全该角色声音绑定。
- AE3. **Covers R8, R9, R10.** Given 章节正文包含旁白和多位角色对白，when 用户点击生成章节音频，then 系统先展示可编辑分段表，而不是直接开始 TTS。
- AE4. **Covers R7, R9.** Given 某角色处在紧张场景中发言，when 系统生成分段脚本，then 该段的合成提示词应结合角色基础语音提示词和当前场景情绪，而不是发送整段角色设定或只依赖 Voicebox personality。
- AE5. **Covers R13, R14.** Given 某章节生成过程中部分分段失败，when 用户查看章节状态，then 系统能显示失败并允许重试，已完成章节仍可试听或下载。

---

## Success Criteria

- 作者能完成一次从 Voicebox 连接、角色声音绑定、AI 切分、人工修正到章节音频生成的闭环。
- 生成失败或角色未配置时，用户知道缺什么、失败在哪、下一步怎么恢复。
- 需求文档足够明确，后续 `/ce-plan` 不需要再发明「有声读物」入口位置、首版生成粒度、Voicebox 职责边界或成功标准。
- 首版验证重点是流程稳定，而不是整本拼接、发布级后期或自动化精修。

---

## Scope Boundaries

- 首版不做整本有声书拼接或一键整本导出。
- 首版不做片段、章节、整本三级音频资产管理；以章节音频为产物单位。
- 首版不在 Story Matrix AI 内上传、训练、复制或维护 Voicebox 音色参考音频。
- 首版不把有声读物能力插入章节创作流程，不影响现有章节写作和全文预览。
- 首版不追求发布级后期处理、多轨混音、音效设计或精细时间轴剪辑。
- 首版不使用 Voicebox 内置 personality prompt 作为角色表现的主来源；如后续使用，也只能作为辅助能力。

---

## Key Decisions

- 入口放在全文预览下：有声读物是成稿后的增强导出能力，而不是写作阶段能力。
- 采用系统+作品两层配置：Voicebox 地址和默认参数属于系统层，旁白/角色绑定与提示词属于作品层。
- 以 Voicebox 为音色源：Story Matrix AI 只读取并绑定 profiles，避免重复建设音色库。
- 由 Story Matrix AI 负责角色语音提示词：角色设定、作品上下文和场景情绪都在本系统内，不能把角色表现外包给 Voicebox 默认 personality。
- 按章节生成：章节是当前产品已有的成稿和预览单位，也能把生成失败控制在较小范围内。
- 分段可编辑：AI 自动识别 speaker 必然会出错，必须在 TTS 前给用户修正机会。

---

## Dependencies / Assumptions

- Voicebox 需要由用户在本机或可信环境中运行，首版以本机服务为主要场景。
- Voicebox 接口契约以运行中的 `http://127.0.0.1:17493/docs` / `openapi.json` 为准；计划和实现阶段必须再次读取实际 schema。
- 当前代码库没有音频/TTS 相关实现；这是新增能力，但可以复用现有角色、章节、全文预览和 AI 提示词链路。
- 章节正文当前是 Markdown 文本，speaker 归属需要通过 AI 自动切分并由用户确认。
- 章节音频可能较大，具体存储、代理下载和清理策略留到实现计划阶段决定。

---

## Outstanding Questions

### Deferred to Planning

- [Affects R2, R13][Needs research] Voicebox 的生成状态 SSE 在当前版本中的事件格式如何稳定解析？
- [Affects R12, R14][Technical] 章节音频应由 Story Matrix AI 代理下载、缓存本地副本，还是直接引用 Voicebox 的 `/audio/{generation_id}`？
- [Affects R8, R10][Technical] 分段脚本应持久化在作品数据里，还是作为章节生成任务的中间状态保存？
- [Affects R13][Technical] 长章节多分段生成时，任务队列、取消、重试和恢复应该如何映射到现有前后端架构？
