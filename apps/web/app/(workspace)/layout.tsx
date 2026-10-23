import {WalletProvider} from '../../components/workspace/Wallet';
import './workspace.css';
export default function WorkspaceLayout({children}:{children:React.ReactNode}){return <WalletProvider>{children}</WalletProvider>;}
