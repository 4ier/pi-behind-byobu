# pi-behind-byobu

[![CI](https://github.com/4ier/pi-behind-byobu/actions/workflows/ci.yml/badge.svg)](https://github.com/4ier/pi-behind-byobu/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

让 **[Pi](https://github.com/earendil-works/pi-coding-agent)** 的会话标题变成 **Byobu/tmux** 的窗口名。

```text
之前   1:zsh  2:node  3:node  4:node       ← 哪个是哪个？
之后   1:zsh  2:π - api-refactor  3:π - docs  4:π - pi-behind-byobu
```

## 问题

在 Byobu 里跑 Pi，每个窗口都叫 `node`：

```text
4:node*     ← 一个 Pi 会话，在干什么？不知道
```

而 Pi 其实一直知道自己在干什么。它会把 `<π> - <会话名> - <目录>` 作为终端标题（OSC 0）发出来——所以你在 Kitty、iTerm2 的标签栏里看到的名字是对的。Byobu 把这信息丢了：它按"当前跑的命令"给窗口命名，而 Pi 跑在 Node 上。

## 为什么

搞清机制就明白为什么各种偏方都不管用。

1. **Pi 写的是"标题"，不是"窗口名"。** `setTitle()` 发的是 `ESC ] 0 ; π - my-project BEL`。在普通终端里这就是标题栏。到了 tmux 手上，它只被记成 **pane 标题**——窗口名是 tmux 自己的东西，一个窗口可以有多个 pane，不能让其中一个随便改。

2. **默认情况下 tmux 不拿标题改窗口名。** Byobu 保持 `allow-rename off`，所以 OSC 0 永远变不成窗口名。手动打开 `allow-rename` 也没用：Byobu 强制 `automatic-rename on`，规则是"取当前命令名"，结果还是把名字盖成 `node`。

3. **pane 标题一直是对的。** `tmux display-message -p '#{pane_title}'` 显示的就是 `π - my-project`。好东西一直躺着没被用。

所以解法不是"让 Pi 去改窗口名"，而是**"让 tmux 只对 Pi 窗口去读 pane 标题"**。

## 安装

```bash
# 直接从仓库跑
npx github:4ier/pi-behind-byobu install

# 或者克隆下来自己跑
git clone https://github.com/4ier/pi-behind-byobu
node pi-behind-byobu/bin/pi-behind-byobu.js install
```

然后自检：

```bash
pi-behind-byobu doctor
```

```text
pi-behind-byobu doctor
  config      ~/.config/byobu/.tmux.conf
  found via   BYOBU_CONFIG_DIR
  this pane   %9 title=[π - pi-behind-byobu] name=[π - pi-behind-byobu]
  ok    Managed block installed and current
  ok    tmux tmux 3.6b
  ok    Running server: automatic-rename is on
  ok    Running server: rename format matches
  ok    No stale Pi window names

5 ok, 0 warning(s), 0 failure(s)
```

`install` 可以反复跑：它只改自己那段带标记的块，第一次安装前会备份一次配置文件，其他内容一律不碰。

## 命令

| 命令 | 作用 |
|---|---|
| `install` | 把受管配置块写进 Byobu 的 tmux 配置文件，立刻应用到正在运行的 server，并把已经开着的 Pi 窗口改好名 |
| `refresh` | 对正在运行的 server 重新应用规则，并刷新名字过期的窗口（沿用 `install` 时记录的选项） |
| `doctor` | 检查规则装了没、是不是最新、有没有真的生效（沿用 `install` 时记录的选项）；有失败项时退出码非 0 |
| `uninstall` | 删掉受管配置块，恢复 tmux 原本的命名行为 |

## 选项

| 选项 | 默认 | 说明 |
|---|---|---|
| `--config <path>` | 自动探测 | Byobu 读的那个 tmux 配置文件（传目录会自动补 `.tmux.conf`） |
| `--tmux-socket <name>` | 当前 server | 指定 tmux socket（`tmux -L <name>`） |
| `--title-prefix <text>` | `π` | Pi 写在标题里的前缀 |
| `--max-length <n>` | `24` | 窗口名截断到 n 个字符，`0` 表示不截断 |
| `--strip-prefix` | 关 | 显示 `my-project` 而不是 `π - my-project` |
| `--dry-run` | 关 | 只打印会改什么，不落盘 |
| `--no-refresh` | 关 | 只应用到 server，不改已经在跑的窗口 |
| `--quiet` | 关 | 只输出问题 |

```bash
# 窗口列表窄，用短名且去掉前缀
pi-behind-byobu install --strip-prefix --max-length 18

# Pi 被改名过（piConfigName），它的标题前缀就不是 π
pi-behind-byobu install --title-prefix PI
```

## 改了什么

往 Byobu 读的 tmux 配置里加一段：

```tmux
# >>> pi-behind-byobu >>>
set -g automatic-rename on
set -g automatic-rename-format '#{?#{m:*π -*,#{pane_title}},#{=24:#{pane_title}},#{?pane_in_mode,[tmux],#{pane_current_command}}#{?pane_dead,[dead],}}'
# <<< pi-behind-byobu <<<
```

那句格式串从里往外读：

| 片段 | 含义 |
|---|---|
| `#{m:*π -*,#{pane_title}}` | 通配符匹配：pane 标题里有 `π -` 吗？（Pi 扩展加的转圈帧也照样匹配） |
| `#{=24:#{pane_title}}` | 有，就用 pane 标题，截断到 24 个字符 |
| `#{?pane_in_mode,[tmux],#{pane_current_command}}#{?pane_dead,[dead],}` | 没有，走 tmux 原样逻辑，完全不变 |

这个前缀守卫就是普通 shell 窗口不受影响的原因：shell 的标题通常是主机名，匹配不上 `π -`，于是照旧显示 `zsh`。

**改哪个文件？** Byobu 只读 `$BYOBU_CONFIG_DIR/.tmux.conf`，默认是 `$XDG_CONFIG_HOME/byobu`，只有历史遗留的 `~/.byobu` 目录已经存在时才用 `~/.byobu`。Byobu **从不读 `~/.tmux.conf`**，写在那里等于没写。`doctor` 会在 `~/.tmux.conf` 里发现 `automatic-rename` 时专门警告这一点。

## 为什么 `install` 要主动改一次窗口名

tmux 只在 pane 标题**发生变化**时才重新套用 `automatic-rename-format`。安装之前就已经在跑的 Pi 会话，除非你切模型、`/rename` 或重启，否则不会再发一次标题，于是窗口名就一直是旧的 `node`。

`install`（和 `refresh`）直接把这些窗口改好名，填上这个空档。这里有个坑：`rename-window` 会被 tmux 视为"手动命名"，并对**该窗口**关掉 `automatic-rename`——如果不处理，之后的 Pi 改名就不再跟着走了。所以工具在每次改名后立刻把 `automatic-rename` 开回去，保证 `/rename` 依然实时生效。

## 环境要求

- **Byobu**（tmux 后端）或原生 tmux 3.0+
- **Node.js 20+**
- macOS 或 Linux。不支持 Windows / WSL（那边没有 Byobu）

用到的格式修饰符（fnmatch `m:`、截断 `=:`、替换 `s/`）从 tmux 3.0 就有。更老的版本 `doctor` 会直接报失败，而不是写一条 server 解析不了的格式进去。

## 排障

**窗口列表还是 `node`。**
跑 `pi-behind-byobu doctor`。它会把运行中的 server 和配置文件对照着看，能分清是"文件没写"、"文件过期"还是"server 没重载"。

**某个窗口不跟着改了。**
那个窗口被手动改名过（`tmux rename-window`），tmux 以此为由关掉了它的自动命名。跑 `pi-behind-byobu refresh` 重新改名并恢复自动命名。

**名字太长。**
`--max-length 18` 或 `--strip-prefix`，然后 `refresh`。

**想卸载。**
`pi-behind-byobu uninstall`。备份在 `<配置文件>.pi-behind-byobu.bak`。

**不用 Byobu，只用原生 tmux？**
这套规则跟 Byobu 无关。把 `--config` 指向你的 tmux 读的文件（原生 tmux 是 `~/.tmux.conf`）即可，`doctor` 只会提示一句"没检测到 Byobu"，其余照常。

## 设计说明

- **零依赖**，没有构建步骤，源码即产物。
- **纯配置，不碰 Pi。** 不需要 Pi 扩展、不需要改 Pi 源码，Pi 升级也不会失效——用的是它一直都在发的标题。
- **所有行为都在真实 tmux 上验证过。** 除了单元测试，`test/integration.tmux.test.js` 会起一个干净的 `tmux -L` server，跑一个假的 Pi 发标题，断言窗口名变化——而且验证两次，证明后续改名依然会传导。
- **幂等。** 一段受管配置块、一份备份；`doctor` 会把文件里的块和当前版本应该渲染的内容做比对，过期就提示。

## 路线图

见 [ROADMAP.md](ROADMAP.md)。一句话：窗口名是第一个问题；下一步是在 Byobu 窗口列表里显示**每个 Pi 会话正在干什么**（干活中 / 等你确认 / 已完成）。

## 参与

见 [CONTRIBUTING.md](CONTRIBUTING.md)。特别欢迎带具体 Byobu/tmux 版本组合的 bug 报告，请附上 `pi-behind-byobu doctor` 的输出。

## 许可

[MIT](LICENSE)
