# 授权与第三方素材声明

本工程的原创代码、文稿、字幕、程序动画及程序合成配乐采用根目录的 [MIT License](LICENSE)，版权归 `2026 ai-shape-film contributors`。本声明列出的第三方内容保留其原有许可。依赖软件、浏览器、语音引擎与模型的许可不因本工程采用 MIT 而改变。

## 随源码分发的字体

| 文件 | 字体 | 授权与版权声明 |
|---|---|---|
| `fonts/SansSC.ttf` | Noto Sans SC | SIL Open Font License 1.1；Copyright 2014–2021 Adobe；Reserved Font Name: `Source`。完整文本见 [NotoSansSC-OFL.txt](fonts/NotoSansSC-OFL.txt)。 |
| `fonts/Mono.ttf` | IBM Plex Mono Regular | SIL Open Font License 1.1；Copyright 2017 IBM Corp.；Reserved Font Name: `Plex`。完整文本见 [IBMPlexMono-OFL.txt](fonts/IBMPlexMono-OFL.txt)。 |

文件名是本工程的资源名称；字体自身的名称与版权信息保留在字体文件内。字体不按 MIT 重新授权。分发或嵌入字体时应保留各自的版权和 OFL 全文；本工程的离线播放器同时内嵌这两份文本。

## 制作参考与内容来源

[AnctyEnly453/abstract-algebra-promo](https://github.com/AnctyEnly453/abstract-algebra-promo) 是制作方法参考：程序绘图、按节拍组织镜头和按绝对时间逐帧导出。本工程的画面、文稿、配乐与导出实现独立编写；不将参考项目的代码、音乐或视频作为本工程素材分发，也不将其作者或模型创作归属转用于本片。

科普内容引用的论文、书籍及各可视化的解释边界见 [内容依据](docs/内容依据.md)。本工程不分发这些文献的全文或图版；文献原作者的权利不受本工程许可影响。

## 开发与导出工具

Node.js、Python、NumPy、Playwright、Sharp、浏览器和 FFmpeg 由使用者另行安装，保留各自许可。Git 源码包不包含它们的可执行程序、依赖缓存或模型文件。`package.json` 与 `requirements.txt` 记录依赖，README 说明安装和使用方式。

若生成配音，配音稿和合成脚本沿用本工程 MIT 许可；使用的具体语音及合成方式由配音文档记录。第三方语音引擎、语音模型及其权重不属于本工程的原创素材，未经另行确认不纳入源码分发。
