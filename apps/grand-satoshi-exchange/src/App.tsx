import { useEffect } from "react";
import {
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { Window } from "./components/ui/Window";
import { TabButton } from "./components/ui/Button";
import { Bank } from "./routes/Bank";
import { Exchange } from "./routes/Exchange";
import { History } from "./routes/History";
import { Settings } from "./routes/Settings";
import { useClientStore } from "./stores/clientStore";

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { client, initializeClient } = useClientStore();

  // Initialize blockchain client on app load
  useEffect(() => {
    if (!client) {
      console.log("[App] Initializing blockchain client...");
      initializeClient();
    }
  }, [client, initializeClient]);

  const tabs = [
    { path: "/bank", label: "Bank" },
    { path: "/exchange", label: "Exchange" },
    { path: "/history", label: "History" },
    { path: "/settings", label: "Settings" },
  ];

  return (
    <div className="app">
      <Window title="Grand Satoshi Exchange">
        {/* Tab Navigation */}
        <div style={{ display: "flex", gap: "4px", marginBottom: "16px" }}>
          {tabs.map((tab) => (
            <TabButton
              key={tab.path}
              active={location.pathname === tab.path}
              onClick={() => navigate(tab.path)}
            >
              {tab.label}
            </TabButton>
          ))}
        </div>

        {/* Routes */}
        <Routes>
          <Route path="/" element={<Navigate to="/bank" replace />} />
          <Route path="/bank" element={<Bank />} />
          <Route path="/exchange" element={<Exchange />} />
          <Route path="/history" element={<History />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Window>
    </div>
  );
}

export default App;
