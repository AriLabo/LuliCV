/**
 * Tells the person this resume has its own stylesheet (appearance.css). Agents write it; people can only
 * remove it, since there is no editor for CSS.
 */
export function CustomCssNote({ onRemove }: { onRemove: () => void }) {
  return (
    <div className="custom-css settings-wide">
      <div className="custom-css__head">
        <strong>这份简历有自定义样式</strong>
        <button type="button" onClick={onRemove}>
          还原
        </button>
      </div>
      <p>只作用于这份简历，换主题时保留。还原会删掉它，页面回到主题本来的样子。</p>
    </div>
  );
}
