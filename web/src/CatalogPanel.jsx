import { useState } from 'react';

const HINT_TEMPLATES = {
  todo: [
    {
      label: '查漏补缺',
      hint: '分析 todo 模块已有功能点清单，结合项目源码，找出测试覆盖的缺口。',
    },
    {
      label: '第 0 章 · 冒烟边界',
      hint: '补充 todo 模块第 0 章「App 级冒烟」的边界场景。',
    },
    {
      label: '第 2 章 · Todo 条目',
      hint: '补充 todo 模块第 2 章「单条 Todo 操作」的完整场景。',
    },
    {
      label: '第 3 章 · Display 排序',
      hint: '补充 todo 模块第 3 章「Display 排序」。',
    },
    {
      label: '第 5 章 · Filter 完整',
      hint: '补充 todo 模块第 5 章「Filter」。',
    },
  ],
  routine: [
    {
      label: '查漏补缺',
      hint: '分析 routine 模块已有功能点清单，结合项目源码，找出测试覆盖的缺口。',
    },
    {
      label: '日程 CRUD',
      hint: '生成 routine 模块的日程基本操作功能点。',
    },
    {
      label: '日程视图',
      hint: '生成 routine 模块的视图切换功能点。',
    },
  ],
  chore: [
    {
      label: '查漏补缺',
      hint: '分析 chore 模块已有功能点清单，结合项目源码，找出测试覆盖的缺口。',
    },
    {
      label: 'Chore CRUD',
      hint: '生成 chore 模块的基本操作功能点。',
    },
  ],
  reward: [
    {
      label: '查漏补缺',
      hint: '分析 reward 模块已有功能点清单，结合项目源码，找出测试覆盖的缺口。',
    },
    {
      label: 'Reward CRUD',
      hint: '生成 reward 模块的基本操作功能点。',
    },
  ],
};

export function CatalogPanel({ moduleId, onBack }) {
  const [copied, setCopied] = useState(null);

  function copyHint(hint) {
    navigator.clipboard.writeText(hint).then(() => {
      setCopied(hint);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  return (
    <div className="catalog-panel">
      <div className="catalog-hd">
        <button type="button" className="back-btn" onClick={onBack}>
          ← 返回功能点
        </button>
        <h2>补功能点</h2>
      </div>

      <div className="catalog-cli-guide">
        <div className="cli-guide-icon">💻</div>
        <h3>使用 CLI 生成功能点</h3>
        <p>
          AI 分析已移至 CLI 端。在终端中运行以下命令，让 Claude
          分析源码并生成功能点：
        </p>
        <pre className="cli-command">
          <code>
            {`# 在 Claude Code 中描述需求\n`}
            {`> 帮我补充 todo 模块的功能点，重点覆盖...`}
          </code>
        </pre>
        <p className="muted">
          生成后会自动写入数据库，刷新此页面即可看到新功能点。
        </p>
      </div>

      <div className="catalog-hint-section">
        <label>常用提示词参考</label>
        {(HINT_TEMPLATES[moduleId] || []).length > 0 && (
          <div className="hint-templates">
            {(HINT_TEMPLATES[moduleId] || []).map((tpl) => (
              <div key={tpl.label} className="hint-tpl-card">
                <div className="hint-tpl-label">{tpl.label}</div>
                <div className="hint-tpl-text">{tpl.hint}</div>
                <button
                  type="button"
                  className="hint-copy-btn"
                  onClick={() => copyHint(tpl.hint)}
                >
                  {copied === tpl.hint ? '已复制 ✓' : '复制'}
                </button>
              </div>
            ))}
          </div>
        )}
        {(HINT_TEMPLATES[moduleId] || []).length === 0 && (
          <p className="muted">该模块暂无预设提示词。</p>
        )}
      </div>
    </div>
  );
}
