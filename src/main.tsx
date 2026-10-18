import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/noto-sans-sc/chinese-simplified-400.css';
import '@fontsource/noto-sans-sc/chinese-simplified-500.css';
import '@fontsource/noto-sans-sc/chinese-simplified-700.css';
import 'misans/lib/Normal/MiSansVF.min.css';
import './studio/fonts.css';
import App from './App';
import './studio/styles.css';
import { BridgeRepository } from './studio/bridge-repository';
import { configureRepository } from './studio/store';
import { RenderApp } from './renderer/RenderApp';
import { loadInstalledThemes } from './themes/installed';
import { errorMessage } from './core/errors';

const root = createRoot(document.getElementById('root')!);
async function bootstrap() {
  const workspaceId = document.querySelector<HTMLMetaElement>('meta[name="cvslate-workspace"]')?.content;
  if (workspaceId) {
    const repository = new BridgeRepository();
    await repository.authenticate();
    if (location.pathname === '/render') {
      root.render(<RenderApp />);
      return;
    }
    // Installed themes load before the editor opens so a resume using one never flashes in the default theme.
    await loadInstalledThemes(repository).catch((error) => console.warn('已安装主题读取失败', error));
    repository.onThemes(() => {
      void loadInstalledThemes(repository).catch((error) => console.warn('已安装主题读取失败', error));
    });
    configureRepository(repository, 'workspace', workspaceId);
  }
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void bootstrap().catch((error) =>
  root.render(
    <div className="loading" role="alert">
      工作区打开失败：{errorMessage(error)}
    </div>,
  ),
);
