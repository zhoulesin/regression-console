/**
 * 功能点清单是外部输入：真源在被测仓的 regression.manifest.json，
 * 控制台只读同步，不提供任何改清单的入口。
 */
export function CatalogPanel({ onBack }) {
  return (
    <div className="catalog-panel">
      <div className="catalog-hd">
        <button type="button" className="back-btn" onClick={onBack}>
          ← 返回功能点
        </button>
        <h2>功能点清单从哪来</h2>
      </div>

      <div className="catalog-cli-guide">
        <div className="cli-guide-icon">📋</div>
        <h3>清单维护在被测仓</h3>
        <p>
          功能点的增删改请在被测项目的
          <code> regression.manifest.json </code>
          里进行，随后回到看板点「同步清单」。
        </p>
        <pre className="cli-command">
          <code>
            {`# 被测项目根目录\n`}
            {`regression.manifest.json   # 功能点真源\n`}
            {`maestro/**                 # 对应的 Maestro 脚本\n`}
            {`  { "module": "todo", "code": "2.1", "title": "…",\n`}
            {`    "criteria": "…", "flow": "maestro/xxx.yaml" }\n`}
            {`  { "module": "todo", "code": "1.6", "title": "…",\n`}
            {`    "criteria": "…", "manual": true }        # 只能手测`}
          </code>
        </pre>
        <p className="muted">
          同步是单向的：控制台不写回被测仓。执行结果、备注、历史轮次仍由控制台记录，
          不会被同步覆盖。
        </p>
      </div>
    </div>
  );
}
