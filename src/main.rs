mod hoslam;
mod map_state;
mod tuya;
mod web;

use anyhow::Result;
use clap::{Parser, Subcommand};
use serde_json::{Map, Value, json};
use std::sync::Arc;
use tuya::{TuyaClient, TuyaConfig};

#[derive(Parser)]
#[command(
    name = "xr500",
    version,
    about = "100% local Rust controller & HoSLAM studio for Liectroux XR500 robot vacuums"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Launch the local Web UI & REST API (serves embedded React SPA + live port 9999 HoSLAM)
    Web {
        #[arg(long, default_value = "127.0.0.1")]
        host: String,
        #[arg(long, default_value_t = 4185)]
        port: u16,
    },
    /// Scan local Wi-Fi subnet (UDP 6667) for Tuya devices
    Scan {
        #[arg(long, default_value_t = 8)]
        seconds: u64,
    },
    /// Print live vacuum telemetry from port 6668
    Status,
    /// Start full-house smart clean
    Start,
    /// Pause current mission
    Pause,
    /// Return to charging dock
    Dock,
    /// Trigger audible "I am here" chime
    Locate,
    /// Set suction power (turnoff | gentle | normal | strong)
    Suction { level: String },
    /// Set mop water flow (closed | low | middle | high)
    Water { level: String },
    /// Clean specific room IDs via DP 15 (0x14)
    CleanRooms {
        rooms: Vec<u8>,
        #[arg(short, long, default_value_t = 1)]
        passes: u8,
    },
    /// Set any raw DP directly (auto-parses bool/int/string)
    RawSet { dp: u32, value: String },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let cfg = TuyaConfig::from_env();

    match cli.command {
        Commands::Scan { seconds } => {
            println!("Scanning LAN (UDP 6667) for {seconds}s...");
            let devs = tuya::scan_lan(seconds).await?;
            if devs.is_empty() {
                println!("No Tuya devices heard. Ensure vacuum is powered on & on same Wi-Fi.");
            } else {
                for d in devs {
                    println!(
                        "  IP: {:<15} | ID: {} | v{} | product: {}",
                        d.ip, d.device_id, d.version, d.product_key
                    );
                }
            }
        }
        Commands::Web { host, port } => {
            let robot_ip = Some(cfg.ip.clone());
            let sim = cfg.simulation;
            let client = Arc::new(TuyaClient::new(cfg));
            let map = map_state::MapState::new(robot_ip, sim);
            let app = web::build_router(web::AppState { tuya: client, map });
            let addr = format!("{host}:{port}");
            let listener = tokio::net::TcpListener::bind(&addr).await?;
            println!("XR500 Local Studio running at http://{addr}");
            axum::serve(listener, app).await?;
        }
        Commands::Status => {
            let client = TuyaClient::new(cfg);
            let st = client.get_status_json().await;
            println!("{}", serde_json::to_string_pretty(&st)?);
        }
        Commands::Start => {
            let client = TuyaClient::new(cfg);
            let mut m = Map::new();
            m.insert("4".into(), json!("smart"));
            m.insert("1".into(), json!(true));
            client.set_dps(m).await?;
            println!("Started full-house clean.");
        }
        Commands::Pause => {
            let client = TuyaClient::new(cfg);
            client.set_dp(2, json!(true)).await?;
            println!("Paused.");
        }
        Commands::Dock => {
            let client = TuyaClient::new(cfg);
            let mut m = Map::new();
            m.insert("3".into(), json!(true));
            m.insert("4".into(), json!("chargego"));
            client.set_dps(m).await?;
            println!("Returning to dock.");
        }
        Commands::Locate => {
            let client = TuyaClient::new(cfg);
            client.set_dp(11, json!(true)).await?;
            println!("Locate chime triggered.");
        }
        Commands::Suction { level } => {
            let client = TuyaClient::new(cfg);
            client.set_dp(9, json!(level)).await?;
            println!("Suction set to {level}.");
        }
        Commands::Water { level } => {
            let client = TuyaClient::new(cfg);
            client.set_dp(10, json!(level)).await?;
            println!("Water flow set to {level}.");
        }
        Commands::CleanRooms { rooms, passes } => {
            let client = TuyaClient::new(cfg);
            let pkt = client.clean_rooms(&rooms, passes).await?;
            println!("Dispatched rooms {:?} ({passes}x) -> DP {} [{}]", rooms, pkt.dp, pkt.base64);
        }
        Commands::RawSet { dp, value } => {
            let client = TuyaClient::new(cfg);
            let parsed: Value = match value.to_lowercase().as_str() {
                "true" => json!(true),
                "false" => json!(false),
                _ => value
                    .parse::<i64>()
                    .map(|n| json!(n))
                    .unwrap_or_else(|_| json!(value)),
            };
            client.set_dp(dp, parsed.clone()).await?;
            println!("Set DP {dp} = {parsed}");
        }
    }
    Ok(())
}
