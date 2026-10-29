import { Link } from 'react-router-dom';
import { usePageTitle } from '../lib/hooks';

export function NotFoundPage() {
  usePageTitle('找不到頁面');
  return (
    <div className="panel">
      <h1>找不到這個頁面</h1>
      <p className="lede">請從總覽或維修單繼續。</p>
      <Link className="btn btn-primary" to="/">
        回到總覽
      </Link>
    </div>
  );
}
