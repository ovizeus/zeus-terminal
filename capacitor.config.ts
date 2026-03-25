import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.zeus.terminal',
    appName: 'Zeus Terminal',
    webDir: 'public',
    server: {
        url: 'https://zeus-terminal.com',
        cleartext: false
    },
    plugins: {
        StatusBar: {
            overlaysWebView: false,
            style: 'DARK',
            backgroundColor: '#0a0e17'
        }
    }
};

export default config;
