---
name: ai-seo-publisher
category: devops
description: AI SEO自动多平台发布系统，让你的品牌出现在所有AI搜索（豆包、Kimi、DeepSeek、通义千问、文心一言等）的搜索结果中。支持百家号、搜狐、头条、知乎（Playwright浏览器自动化）、微信公众号（API免登录）
tags: [seo, publish, automation, playwright, wechat, zhihu, baijiahao]
---

# AI SEO Publisher

**项目路径**: `/home/ubuntu/ai-seo-publisher/`

让你的品牌出现在豆包、Kimi、DeepSeek、通义千问、文心一言、腾讯元宝、天工AI的搜索结果中。

## 支持平台

| 平台 | 方式 | 登录方式 | 覆盖AI模型 |
|------|------|---------|-----------|
| **百家号** | Playwright自动化 | 首次扫码 | 文心一言、通义千问 |
| **搜狐号** | Playwright自动化 | 首次扫码 | DeepSeek、Kimi、通义千问、天工AI |
| **今日头条** | Playwright自动化 | 首次扫码 | 豆包、通义千问 |
| **知乎专栏** | Playwright自动化 | 首次扫码 | Kimi、天工AI |
| **微信公众号** | API模式 | **免登录**（AppID+AppSecret） | 腾讯元宝、Kimi |
| **网易号** | ❌ 待开发 | — | DeepSeek、通义千问、天工AI |
| **百度百科** | 半自动（人工审核） | — | 文心一言、DeepSeek |

## 首次使用

### 1. 安装依赖（已完成）
```bash
cd /home/ubuntu/ai-seo-publisher
pip install --break-system-packages -r requirements.txt
```

### 2. 配置账号
```bash
python3 publish.py setup
```
交互式添加各平台账号。

### 3. 首次扫码登录（每个平台只需要一次）
```bash
# 交互式引导（推荐）
python3 first_login.py

# 或单独登录
python3 publish.py login --platform baijiahao
python3 publish.py login --platform toutiao
python3 publish.py login --platform sohu
python3 publish.py login --platform zhihu
```

### 4. 配置微信公众号API（免登录）
需要：
1. 登录 https://mp.weixin.qq.com
2. 设置与开发 → 基本配置 → 获取 AppID / AppSecret
3. 把服务器IP `curl ifconfig.me` 加入IP白名单
4. 运行 `python3 publish.py setup` 选择 wechat 填入

## 日常发布

### 一键发布到所有平台
```bash
python3 publish.py publish -t "文章标题" -c "文章正文内容"
```

### 发布到指定平台
```bash
python3 publish.py publish -t "标题" -c "内容" -p wechat,zhihu,baijiahao
```

### 从Markdown文件发布
```bash
python3 publish.py publish-file -f article.md
```

### Shell脚本发布
```bash
./seo_publish.sh "标题" "内容"
./seo_publish.sh article.md
echo "内容" | ./seo_publish.sh "标题"
```

### 查看状态
```bash
python3 publish.py status   # 查看已配置的账号
python3 publish.py list     # 查看支持的平台
```

## Cron定时发布

在 Hermes 中设置定时任务：
```bash
cronjob --action create \
  --schedule "0 10 * * *" \
  --name "AI SEO Daily Publish" \
  --prompt "运行 /home/ubuntu/ai-seo-publisher/publish.py publish-file -f /path/to/today_article.md -p wechat,zhihu,baijiahao,toutiao,sohu"
```

## 项目结构

```
ai-seo-publisher/
├── publish.py               # 主入口CLI
├── first_login.py           # 首次扫码登录引导
├── seo_publish_cron.py      # cron调度用的脚本
├── seo_publish.sh           # Shell一键发布
├── requirements.txt
├── __init__.py
├── src/
│   ├── publisher.py         # 核心发布引擎
│   ├── config.py            # 配置管理
│   ├── wechat_publisher.py  # 微信公众号API发布
│   ├── baike.py             # 百度百科辅助
│   ├── netease_publisher.py # 网易号（待开发）
│   ├── adapters/            # 内容工厂的原始适配器
│   │   ├── base_adapter.py
│   │   ├── baijiahao_adapter.py
│   │   ├── toutiao_adapter.py
│   │   ├── sohu_adapter.py
│   │   └── zhihu_adapter.py
│   ├── browser/             # 浏览器管理
│   └── core/               # 核心模块
└── data/                   # 数据目录
```

## 注意事项

1. **登录问题**：Playwright自动化的平台（百家号/头条/搜狐/知乎）首次需要扫码登录，Cookie存在 `~/.ai-seo-publisher/cookies/`，后续自动复用
2. **Cookie过期**：一般1-7天有效，到期需重新扫码。实测5天（7/20→7/25）仍有效
3. **微信API**：完全免登录，但需要公网IP加入微信白名单
4. **反爬检测**：浏览器自动化已加入随机延迟、模拟人工输入等机制
5. **网易号**：暂无开源项目，后续可根据搜狐号adapter的模式自行开发
6. **Playwright安装**：pip默认源慢，用清华镜像 `pip install --break-system-packages -i https://pypi.tuna.tsinghua.edu.cn/simple playwright`
7. **浏览器**：**不要**下载playwright chromium（177MB太慢），用系统Chrome：`channel="chrome"`

## 头条发布 — 已知限制 ⚠️

### 预览弹窗无法自动化
点击"预览并发布"后出现的预览/确认弹窗：
- ❌ **不是**新窗口（`wait_for_event("popup")` 超时）
- ❌ **不是** iframe
- ❌ **不是**标准 HTML dialog（`querySelector('[role=dialog] button')` 返回空）
- ✅ **只能**在 headed 模式看到弹窗（headless 不显示）

**结论：头条发布需要大哥在 X2Go 桌面手动点最后一下「发布」确认。** 自动化可以完成填标题、填正文、点"预览并发布"，但最后确认需要人工。

### 内容最低字数
- 正文需要足够长，太短会提示"还需输入 N 个字"，导致发布按钮不可用
- 建议正文 100+ 字

## 实战经验（踩坑记录）

### 头条发布流程（已验证）

**登录方式**：DISPLAY=:50.0 开headed浏览器，大哥在X2Go桌面扫码

```bash
# 先清理之前的浏览器锁（非常重要！）
rm -f /home/ubuntu/.ai-seo-publisher/cookies/toutiao_login/SingletonLock
rm -f /home/ubuntu/.ai-seo-publisher/cookies/toutiao_login/SingletonCookie
rm -f /home/ubuntu/.ai-seo-publisher/cookies/toutiao_login/SingletonSocket

# 用 background=true 启动headed浏览器
# Python脚本内容：launch_persistent_context → goto发布页 → 等待大哥扫码
```

**头条发布页关键信息**：
- URL: `https://mp.toutiao.com/profile_v4/graphic/publish`
- 标题输入框: `textarea`（placeholder="请输入文章标题（2～30个字）"）
- 正文编辑器: `.ProseMirror`
- 发布按钮: **"预览并发布"**（不是"发布"也不是"定时发布"）
- 标题限制: **2-30个字**，超出会导致按钮不可用

**弹窗处理**：头条发布页常有弹窗（欢迎提示等）挡住输入框
```python
# 方案1: 按Escape关弹窗
page.keyboard.press("Escape")

# 方案2: 用JS强制隐藏
page.evaluate("""
    document.querySelectorAll("[role=dialog], .byte-modal-wrapper, .modal")
        .forEach(function(el) { el.style.display = "none"; el.style.pointerEvents = "none"; });
""")
```

**填标题和正文**：推荐用JS直接设置value避免被弹窗挡住
```python
page.evaluate("document.querySelector('textarea').value = '标题'; document.querySelector('textarea').dispatchEvent(new Event('input', {bubbles: true}))")
```

**发布操作**：用JS遍历按钮找到"预览并发布"点击
```python
page.evaluate("""
    var btns = document.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.trim().indexOf('预览并发布') !== -1) {
            btns[i].click(); break;
        }
    }
""")
```

**资源竞争问题**：
- 使用 `launch_persistent_context` 时，同一个profile目录只能被一个浏览器实例使用
- 之前开的浏览器没关的话，会报 `Failed to create a ProcessSingleton`
- 解决方案：先清理Singleton文件，或先 `pkill -f chrome` 杀掉旧进程

### 推荐的头条发布Python模板
放在 `/tmp/toutiao_publish_v3.py`（已验证可工作）

### 当前可用的头条发布脚本路径
- `/tmp/toutiao_headed_v4.py` — headed模式，填内容+点预览并发布，弹窗需人工确认
- 启动方式：`DISPLAY=:50 XAUTHORITY=/home/ubuntu/.Xauthority python3 /tmp/toutiao_headed_v4.py`
- 浏览器出现在 X2Go 桌面，大哥只需点一下发布确认
