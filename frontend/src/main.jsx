import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, NavLink, Link } from 'react-router-dom';
import AuctionList from './pages/AuctionList.jsx';
import AuctionDetail from './pages/AuctionDetail.jsx';
import CreateRfq from './pages/CreateRfq.jsx';
import './styles.css';

function Shell() {
  return (
    <>
      <nav className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            <img src="/favicon.svg" alt="" width="26" height="26" />
            <span>LastCall</span>
            <small>British Auction RFQs</small>
          </Link>
          <div className="nav-links">
            <NavLink to="/" end>Auctions</NavLink>
            <NavLink to="/rfqs/new">Create RFQ</NavLink>
          </div>
        </div>
      </nav>
      <main className="container">
        <Routes>
          <Route path="/" element={<AuctionList />} />
          <Route path="/rfqs/new" element={<CreateRfq />} />
          <Route path="/rfqs/:id" element={<AuctionDetail />} />
          <Route path="*" element={<p>Page not found. <Link to="/">Go home</Link></p>} />
        </Routes>
      </main>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  </React.StrictMode>,
);
