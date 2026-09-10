# GitHub 与树莓派部署

推荐使用 64 位 Raspberry Pi OS（`uname -m` 应为 `aarch64`），通过 Docker Compose 运行。镜像使用 Node.js 24，支持 ARM64；32 位系统不在本方案验证范围内。

## 上传 GitHub

在 GitHub 新建空仓库，不勾选初始化 README 或 .gitignore。项目根目录运行（将地址替换成自己的仓库）：

```sh
git init -b main
git add .
git commit -m "Initial story house application"
git remote add origin https://github.com/YOUR_NAME/YOUR_REPO.git
git push -u origin main
```

使用 Git Credential Manager、浏览器授权或 SSH 完成身份验证，不要把访问令牌写进远程 URL。项目已忽略 `.env`、录音、数据库和测试文件。GitHub 只存代码；本机已上传的录音不会随 clone 自动出现。

## 树莓派运行（推荐 Docker）

先按照 Docker 官方 Debian 安装说明安装 Docker Engine 与 Compose 插件：
https://docs.docker.com/engine/install/debian/

```sh
git clone https://github.com/YOUR_NAME/YOUR_REPO.git story-house
cd story-house
cp .env.example .env
nano .env
```

在 `.env` 中为 `ADMIN_PASSWORD` 填入自己的管理密码。使用普通局域网 HTTP 时保留 `COOKIE_SECURE=0`。端口默认 5173。

```sh
sudo docker compose up -d --build
sudo docker compose ps
sudo docker compose logs --tail=50
hostname -I
```

在同一局域网打开：

- 前台：`http://树莓派IP:5173/`
- 后台：`http://树莓派IP:5173/admin`

前台不需要账号，后台输入 `.env` 中的管理密码。容器自动重启策略已配置；Docker 服务应启用开机启动（`sudo systemctl enable docker`）。后台上传的数据保存在独立 Docker 卷 `story-data` 中，重新构建不会丢失。不运行 `docker compose down -v`，该命令会删除数据卷。

## 更新代码

更新后启动会自动迁移旧数据库，并将包内口袋神探第 1～7 季目录及本地图片导入数据卷。不会上传或覆盖已有录音；建议更新前按下文先备份。已导入的季不会每次启动重复导入。

```sh
git pull --ff-only
sudo docker compose up -d --build
sudo docker compose ps
```

服务重启会清除后台登录会话，重新输入管理密码即可。SQLite 和录音保留。

## 备份 Docker 数据

在项目目录执行，暂停服务以保持数据库和音频一致：

```sh
mkdir -p backups
sudo docker compose stop stories
sudo docker compose run --rm --no-deps --user root --entrypoint tar stories -czf - -C /app/data . > "backups/stories-$(date +%Y%m%d-%H%M%S).tar.gz"
sudo docker compose start stories
```

备份失败也应执行最后的 start 命令恢复服务。恢复时，先停止服务，确认备份内容后，将备份中的数据完整解压到 `/app/data`，并保证所有者为容器的 `node` 用户（UID/GID 1000）。不要把旧库和新库混合覆盖；建议恢复到新的空数据卷。

## 不使用 Docker

安装适用于 ARM64 的 Node.js 24，确认 `node --version` 为 v24 或更高，再运行：

```sh
cp .env.example .env
nano .env
npm start
```

无需 `npm install`。这种方式数据在项目的 `data/` 目录，关闭终端会停止服务；长期运行建议采用上面的 Docker 方案。公网访问应使用 HTTPS 反向代理，同时设置 `COOKIE_SECURE=1`；本项目尚未在实际树莓派上运行验收。
