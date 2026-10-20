# T001 基线验证证据

- React `npm test`：退出码 0；4 个测试文件、25 项测试通过。
- React `npm run build`：退出码 0；TypeScript 与 Vite 构建通过。
- Cocos `npm run validate:a0`：退出码 0；A0 manifest and scene contract: PASS。
- Git 范围扫描：无 node_modules、Cocos library/temp/build、凭据或测试截图进入索引。
- `git ls-files web-prototype/artifacts`：0；物理截图保留但已被根级忽略规则排除。
- 基线提交：38426d7；忽略规则修正提交：f749faa。
