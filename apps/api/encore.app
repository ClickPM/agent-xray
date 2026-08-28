{
	"id":   "",
	"lang": "typescript",

	// Bun 统一运行时(R-BUN,2026-08-29)。开启后 encore run / encore build docker
	// 都用 bun 执行应用进程,而不是 node。
	//
	// ⚠️ 只写这一行是不够的:Encore 开启 bun-runtime 后会把镜像 ENTRYPOINT 改成
	//    `bun run ...`,却仍按默认基座 node:slim 打包,产出的镜像里没有 bun,
	//    `docker run` 直接 `exec: "bun": executable file not found in $PATH`。
	//    构建时必须配套 `--base oven/bun:<版本>-slim`(已固化进 dev.ps1 build)。
	//    encore.app 的 build.docker.base_image 对本地 `encore build docker` **无效**
	//    (schema 注释:该字段仅作用于 Encore 自家 CI/CD),验证过,别再往这里加。
	//    上游缺陷已记 rounds/BACKLOG.md。
	//
	// bun 版本钉死在 CLAUDE.md「钉版本」表,与 dev.ps1 build 的 --base 保持一致。
	"experiments": ["bun-runtime"]
}
