# Cloudflare 免费版部署

本项目现在包含 Cloudflare Worker 和 Durable Object 入口，游戏网页与后端一起部署到同一个网址。比赛由服务器计算，房主电脑只显示自己的画面。无需游戏账号、历史战绩数据库或自购域名。此版本已通过 Cloudflare 本地运行环境的联机测试及部署打包检查，尚未发布到你的 Cloudflare 账号；公网延迟和不同地区的可访问性需要上线后实测。

**第一步：上传准备好的文件。** 项目中的 deploy-upload 文件夹只包含本次部署需要的文件。建议在 GitHub 新建一个名为 aqua-rush-cloudflare 的仓库，勾选添加 README，让仓库先有一个首页，然后点击 Add file → Upload files。打开本地 deploy-upload，全选里面的文件与子文件夹，拖到上传区，最后点击 Commit changes。上传的是文件夹里面的内容，不是 deploy-upload 文件夹本身。完成后仓库首页应该直接看到 package.json、wrangler.jsonc、index.html，以及 cloudflare 和 scripts 文件夹。原来的单机仓库可以继续保留。

**第二步：连接 Cloudflare。** 回到 Workers & Pages，点击 Create application，选择连接或导入 GitHub 仓库的入口（通常标为 Continue with GitHub 或 Import a repository）。如需授权 GitHub，选择刚才新建的仓库即可。选择 aqua-rush-cloudflare，继续进入构建和部署设置。这是 Worker 应用，不要选择仅上传静态文件的 Pages 流程。

**第三步：填写部署设置。** 项目名称或 Worker name 填 aqua-rush-gp，与 wrangler.jsonc 一致。生产分支选择你刚才上传文件的分支，通常是 main。Root directory 保持仓库根目录，留空或保留页面默认值。Build command 填 npm run build:cloudflare。Deploy command 填 npx wrangler deploy。无需添加 PORT、数据库连接或运行环境密钥。没有单独的“输出目录”要填，项目配置已指定 dist/public。如果页面只有 Pages 的框架与输出目录设置，请返回 Worker 的 Git 导入入口。首次使用 workers.dev 时，按页面提示选择免费的账号子域名即可。

**第四步：部署。** 保持 Workers Free，点击 Deploy，等待构建和部署成功。构建过程会安装项目依赖并上传游戏文件与后端。配置里的 ROOMS 绑定和 RaceRoom 类型会自动创建；不需要手动创建 D1 数据库，也不需要购买套餐。若页面要求升级付费，不要确认，先检查是不是选错了产品入口。成功后打开该 Worker 页面显示的 workers.dev 网址；它才是联机版的正式入口。网址的账号部分由 Cloudflare 分配，这份说明不预填一个不存在的网址。

**第五步：测试。** 先打开新网址，在 MULTIPLAYER 中填写昵称并 Create room，应该得到六位房间码。朋友在另一台电脑打开同一个新网址，填写昵称、房间码并 Join room。所有人点击 Ready 后，房主点击 Start race。两名玩家时自动补两个人机。比赛开始后房主离开，其他玩家仍应继续比赛，房主的船由人机接管。最后所有人离开，旧房间码应失效。实际游玩尽量用两台电脑测试，同一台电脑同时运行两个游戏窗口会增加绘图负担。

**第六步：以后更新。** 修改项目后重新生成 deploy-upload，再将里面的更新上传至同一 GitHub 仓库。连接成功后，该生产分支的新提交会自动触发 Cloudflare 重新部署。更新或平台重启可能终止正在进行的临时房间，所以尽量在没有人比赛时更新。确认新网址工作正常后，再去 Render 停止旧服务；本次代码修改没有操作你的 Render 账号。

**费用与使用边界。** 当前配置使用免费套餐支持的 SQLite-backed Durable Objects，但代码不向数据库保存账号或比赛记录。房间只放在运行内存里，全部玩家离开即删除；服务重启或发布更新可能清空房间。每个房间最长两小时，比赛最长十五分钟。房间有人连接时会消耗 Durable Object 活跃时长，等待大厅也会消耗；关闭游戏页面可结束连接。免费额度是账号共享且有限的，用完后请求会失败，并非无限制服务。不要升级 Workers Paid，即可避免该付费套餐的固定月费。以 Cloudflare 当前账号页面和官方计费说明为准：https://developers.cloudflare.com/durable-objects/platform/pricing/ 。

按照当前每位玩家持续按住同一组按键时每秒约 20 条输入消息估算，再按官方 20:1 折算与每天 100,000 次免费请求额度计算，四人持续比赛合计约 6.9 小时就可能接近请求上限，两人约 13.8 小时；多个房间共享额度，按键变化会立即额外发送，实际还要扣除连接、心跳和其他请求。这只是容量估算，不是保证时长。它适合少量朋友偶尔玩，不能当作无限量公开联机服务。

**本地开发。** 使用 Node.js 22 或更新版本，安装依赖后，npm run dev:cloudflare 启动 Cloudflare 本地环境，npm run build:cloudflare 生成网页资源，npm run test:cloudflare 验证 Cloudflare 房间协议。原来的启动联机.command 和 npm start 继续启动 Node 本地版本。scripts/prepare-upload.cjs 用于重新生成 deploy-upload，直接运行 node scripts/prepare-upload.cjs 即可；不修改备份目录。

本次验证包括原联机模拟与启动器测试，以及实际 Cloudflare 本地运行环境中的四人容量、独立房间、至少两人且全部准备才能开赛、服务端位置校验、同步快照、AI 补位、房主离开、重连、空房清理、跨站连接拒绝和私有文件不可下载。浏览器也实际创建了六位码房间并检查英文界面。没有把本地测试结果当作公网延迟保证。

Cloudflare 的构建字段依据官方说明：https://developers.cloudflare.com/workers/ci-cd/builds/configuration/ 。


手机操作：先选择地图，再点击 START 或 MULTIPLAYER，进入 DRIVING SETTINGS。设备模式支持 AUTO、DESKTOP、MOBILE，会记住手动选择；换地图时不会提前弹出权限面板。点击 ENABLE TILT & FULLSCREEN，在浏览器询问时允许运动／方向访问，再横持手机点击 CENTER STEERING 校准。收到传感器数据后按钮才会亮起并显示 TILT ENABLED。右侧 FORWARD 长按前进，BRAKE / REVERSE 长按先刹车再倒车。未启用倾斜也可点击 CONTINUE WITH TOUCH BUTTONS，使用左侧触屏转向按钮。比赛中的 DRIVING SETTINGS 用于修改驾驶方式，RECENTER TILT 把当前手机倾角设为直行方向，点击后显示校准提示。单机中打开设置会暂停比赛，联机中不会暂停其他玩家。

单机 PAUSE 菜单新增 MAIN MENU / CHANGE MAP，点击会结束当前比赛并回到地图选择。泳圈显示与远端船只改用同一组平滑位置，碰撞分离偏移逐步恢复；同步延迟仍可能造成短暂接触误差。

隐藏地址栏由浏览器决定，网页不能保证强制隐藏。支持全屏时点击 FULLSCREEN；若无效，在手机浏览器中选择“添加到主屏幕”，之后从桌面图标打开。iPhone 使用 Safari 的分享菜单，并在提供此选项时启用“作为网页 App 打开”。横屏锁定同样取决于浏览器，不能自动锁定时请手动横持并关闭系统竖屏锁定。此功能不提供离线游戏。

更新部署时上传 deploy-upload 文件夹里面的全部内容到仓库根目录，保留其中的 scripts、tests、cloudflare 子目录；不要把 deploy-upload 文件夹本身再套在仓库根目录外。等待 Cloudflare 新部署成功后，在手机上重新打开 Production 的 HTTPS 地址。手机和电脑都应刷新到同一版本。
