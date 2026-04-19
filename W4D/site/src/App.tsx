import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { Navbar, Alignment, Button, Tag, Classes } from "@blueprintjs/core";
import { useQuery } from "@tanstack/react-query";
import WarRoom from "./pages/WarRoom";
import Signals from "./pages/Signals";
import Backtest from "./pages/Backtest";
import Attribution from "./pages/Attribution";
import Live from "./pages/Live";

function NavBar() {
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: () => fetch("/health").then((r) => r.json()),
    refetchInterval: 10_000,
  });

  return (
    <Navbar className={Classes.DARK} style={{ paddingLeft: 16 }}>
      <Navbar.Group align={Alignment.LEFT}>
        <Navbar.Heading style={{ fontWeight: 700, letterSpacing: 2, color: "#48aff0" }}>
          W4D
        </Navbar.Heading>
        <Navbar.Divider />
        <NavLink to="/" end>
          {({ isActive }) => (
            <Button minimal active={isActive} icon="dashboard" text="War Room" />
          )}
        </NavLink>
        <NavLink to="/signals">
          {({ isActive }) => (
            <Button minimal active={isActive} icon="pulse" text="Signals" />
          )}
        </NavLink>
        <NavLink to="/backtest">
          {({ isActive }) => (
            <Button minimal active={isActive} icon="timeline-line-chart" text="Backtest" />
          )}
        </NavLink>
        <NavLink to="/attribution">
          {({ isActive }) => (
            <Button minimal active={isActive} icon="pie-chart" text="Attribution" />
          )}
        </NavLink>
        <NavLink to="/live">
          {({ isActive }) => (
            <Button minimal active={isActive} icon="database" text="Live Data" intent={isActive ? "success" : "none"} />
          )}
        </NavLink>
      </Navbar.Group>
      <Navbar.Group align={Alignment.RIGHT}>
        <Tag
          intent={health?.status === "ok" ? "success" : "danger"}
          minimal
          style={{ marginRight: 12 }}
        >
          {health?.status === "ok" ? "QUANT LIVE" : "OFFLINE"}
        </Tag>
        <span style={{ color: "#738091", fontSize: 11 }}>:4040</span>
      </Navbar.Group>
    </Navbar>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ background: "#1c2127", minHeight: "100vh", color: "#f6f7f9" }}>
        <NavBar />
        <div style={{ padding: "20px 24px" }}>
          <Routes>
            <Route path="/" element={<WarRoom />} />
            <Route path="/signals" element={<Signals />} />
            <Route path="/backtest" element={<Backtest />} />
            <Route path="/attribution" element={<Attribution />} />
            <Route path="/live" element={<Live />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  );
}
