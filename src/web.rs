//! Axum HTTP Server + Embedded React SPA (Single-Binary Deployment)

use crate::map_state::MapState;
use crate::tuya::TuyaClient;
use axum::extract::{Path as AxumPath, State};
use axum::http::{StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router};
use rust_embed::Embed;
use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::sync::Arc;
use tower_http::cors::CorsLayer;

#[derive(Embed)]
#[folder = "static/"]
struct StaticAssets;

#[derive(Clone)]
pub struct AppState {
    pub tuya: Arc<TuyaClient>,
    pub map: Arc<MapState>,
}

#[derive(Deserialize)]
struct LevelReq {
    level: String,
}
#[derive(Deserialize)]
struct DirReq {
    direction: String,
}
#[derive(Deserialize)]
struct VolReq {
    volume: i64,
}
#[derive(Deserialize)]
struct ToggleReq {
    feature: String,
    enabled: bool,
}
#[derive(Deserialize)]
struct ResetReq {
    part: String,
}
#[derive(Deserialize)]
struct DpReq {
    value: Value,
}
#[derive(Deserialize)]
struct RoomsReq {
    room_ids: Vec<u8>,
    passes: Option<u8>,
}
#[derive(Deserialize)]
struct ZoneItem {
    x1: f64,
    y1: f64,
    x2: f64,
    y2: f64,
    passes: Option<u8>,
}
#[derive(Deserialize)]
struct ZonesReq {
    zones: Vec<ZoneItem>,
}
#[derive(Deserialize)]
struct GotoReq {
    x: f64,
    y: f64,
    spot_clean: Option<bool>,
}
#[derive(Deserialize)]
struct RoomPatchReq {
    name: Option<String>,
    color: Option<String>,
    suction: Option<String>,
    water: Option<String>,
}
#[derive(Deserialize)]
struct NoGoReq {
    x1: f64,
    y1: f64,
    x2: f64,
    y2: f64,
    name: Option<String>,
}
#[derive(Deserialize)]
struct VWallReq {
    x1: f64,
    y1: f64,
    x2: f64,
    y2: f64,
}
#[derive(Deserialize)]
struct PoopReq {
    x: f64,
    y: f64,
    radius_px: Option<f64>,
    label: Option<String>,
}
#[derive(Deserialize)]
struct PlaceCreateReq {
    name: String,
    color: Option<String>,
    x1: f64,
    y1: f64,
    x2: f64,
    y2: f64,
    passes: Option<u8>,
}
#[derive(Deserialize)]
struct PlacePatchReq {
    name: Option<String>,
    color: Option<String>,
    passes: Option<u8>,
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/api/status", get(get_status))
        .route("/api/dps/raw", get(get_raw_dps))
        .route("/api/command/{action}", post(post_command))
        .route("/api/suction", post(post_suction))
        .route("/api/water", post(post_water))
        .route("/api/direction", post(post_direction))
        .route("/api/volume", post(post_volume))
        .route("/api/toggle", post(post_toggle))
        .route("/api/consumable/reset", post(post_consumable_reset))
        .route("/api/dp/{dp_id}", post(post_dp))
        .route("/api/map", get(get_map))
        .route("/api/map/sync", post(post_map_sync))
        .route("/api/clean-rooms", post(post_clean_rooms))
        .route("/api/clean-zones", post(post_clean_zones))
        .route("/api/goto", post(post_goto))
        .route("/api/map/rooms/{room_id}", patch(patch_room))
        .route("/api/map/nogo", post(post_nogo))
        .route("/api/map/nogo/{zone_id}", delete(delete_nogo))
        .route("/api/map/vwall", post(post_vwall))
        .route("/api/map/vwall/{wall_id}", delete(delete_vwall))
        .route("/api/map/poop", post(post_poop))
        .route("/api/map/poop/{hazard_id}", delete(delete_poop))
        .route("/api/map/push-nogo", post(post_push_nogo))
        .route("/api/map/places", post(post_place))
        .route("/api/map/places/{place_id}", patch(patch_place).delete(delete_place))
        .route("/api/map/reset-trajectory", post(post_reset_traj))
        .fallback(serve_static)
        .layer(CorsLayer::permissive())
        .with_state(state)
}

async fn get_status(State(s): State<AppState>) -> Json<Value> {
    Json(s.tuya.get_status_json().await)
}

async fn get_raw_dps(State(s): State<AppState>) -> Json<Value> {
    let (dps, _, _) = s.tuya.get_raw_dps().await;
    let schema: Value = std::fs::read_to_string("docs/dp_schema.json")
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.get("datapoints").cloned())
        .unwrap_or_else(|| json!({}));
    Json(json!({
        "dps": dps,
        "schema": schema,
        "profile": "T3",
        "simulation": s.tuya.cfg.simulation
    }))
}

async fn post_command(
    State(s): State<AppState>,
    AxumPath(action): AxumPath<String>,
) -> impl IntoResponse {
    let res = match action.to_lowercase().as_str() {
        "start" => {
            let mut m = Map::new();
            m.insert("4".into(), json!("smart"));
            m.insert("1".into(), json!(true));
            s.tuya.set_dps(m).await
        }
        "pause" => s.tuya.set_dp(2, json!(true)).await,
        "dock" => {
            let mut m = Map::new();
            m.insert("3".into(), json!(true));
            m.insert("4".into(), json!("chargego"));
            s.tuya.set_dps(m).await
        }
        "locate" => s.tuya.set_dp(11, json!(true)).await,
        "wallfollow" => {
            let mut m = Map::new();
            m.insert("4".into(), json!("wallfollow"));
            m.insert("1".into(), json!(true));
            s.tuya.set_dps(m).await
        }
        _ => return (StatusCode::BAD_REQUEST, Json(json!({"error": "unknown action"}))),
    };
    (
        StatusCode::OK,
        Json(json!({"status": "ok", "action": action, "success": res.is_ok()})),
    )
}

async fn post_suction(State(s): State<AppState>, Json(req): Json<LevelReq>) -> Json<Value> {
    let lower = req.level.to_lowercase();
    let mapped = match lower.as_str() {
        "closed" | "off" => "turnoff",
        "low" => "gentle",
        "high" | "max" => "strong",
        other => other,
    };
    let ok = s.tuya.set_dp(9, json!(mapped)).await.is_ok();
    Json(json!({"status": "ok", "suction": mapped, "success": ok}))
}

async fn post_water(State(s): State<AppState>, Json(req): Json<LevelReq>) -> Json<Value> {
    let lower = req.level.to_lowercase();
    let mapped = match lower.as_str() {
        "off" => "closed",
        "normal" | "med" | "medium" => "middle",
        other => other,
    };
    let ok = s.tuya.set_dp(10, json!(mapped)).await.is_ok();
    Json(json!({"status": "ok", "water_level": mapped, "success": ok}))
}

async fn post_direction(State(s): State<AppState>, Json(req): Json<DirReq>) -> Json<Value> {
    let lower = req.direction.to_lowercase();
    let mapped = match lower.as_str() {
        "forward" => "foward",
        "left" => "turn_left",
        "right" => "turn_right",
        "back" => "backward",
        other => other,
    };
    let ok = s.tuya.set_dp(12, json!(mapped)).await.is_ok();
    Json(json!({"status": "ok", "direction": mapped, "success": ok}))
}

async fn post_volume(State(s): State<AppState>, Json(req): Json<VolReq>) -> Json<Value> {
    let v = req.volume.clamp(0, 100);
    let ok = s.tuya.set_dp(26, json!(v)).await.is_ok();
    Json(json!({"status": "ok", "volume": v, "success": ok}))
}

async fn post_toggle(State(s): State<AppState>, Json(req): Json<ToggleReq>) -> impl IntoResponse {
    let dp = match req.feature.as_str() {
        "dnd" => 25,
        "break_clean" => 27,
        "y_mop" => 104,
        "custom_mode" => 105,
        _ => return (StatusCode::BAD_REQUEST, Json(json!({"error": "unknown feature"}))),
    };
    let ok = s.tuya.set_dp(dp, json!(req.enabled)).await.is_ok();
    (
        StatusCode::OK,
        Json(json!({"status": "ok", "feature": req.feature, "enabled": req.enabled, "success": ok})),
    )
}

async fn post_consumable_reset(
    State(s): State<AppState>,
    Json(req): Json<ResetReq>,
) -> impl IntoResponse {
    let dp = match req.part.as_str() {
        "edge_brush" => 18,
        "roll_brush" => 20,
        "filter" => 22,
        "duster_cloth" => 24,
        _ => return (StatusCode::BAD_REQUEST, Json(json!({"error": "unknown part"}))),
    };
    let ok = s.tuya.set_dp(dp, json!(true)).await.is_ok();
    (StatusCode::OK, Json(json!({"status": "ok", "part": req.part, "success": ok})))
}

async fn post_dp(
    State(s): State<AppState>,
    AxumPath(dp_id): AxumPath<u32>,
    Json(req): Json<DpReq>,
) -> Json<Value> {
    let ok = s.tuya.set_dp(dp_id, req.value.clone()).await.is_ok();
    Json(json!({"status": "ok", "dp_id": dp_id, "value": req.value, "success": ok}))
}

async fn get_map(State(s): State<AppState>) -> Json<Value> {
    let st = s.tuya.cached_status_str();
    let active = matches!(
        st.as_str(),
        "cleaning" | "smart" | "zone_clean" | "part_clean" | "select_room" | "goto_pos" | "goto_charge" | "wall_follow"
    );
    Json(s.map.to_api_json(active))
}

async fn post_map_sync(State(s): State<AppState>) -> Json<Value> {
    let _ = s.tuya.set_dp(16, json!("get_both")).await;
    Json(json!({"status": "ok", "synced": true, "is_real_slam": true}))
}

async fn post_clean_rooms(State(s): State<AppState>, Json(req): Json<RoomsReq>) -> impl IntoResponse {
    match s.tuya.clean_rooms(&req.room_ids, req.passes.unwrap_or(1)).await {
        Ok(pkt) => (
            StatusCode::OK,
            Json(json!({"status": "ok", "room_ids": req.room_ids, "passes": req.passes.unwrap_or(1), "packet": pkt})),
        ),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))),
    }
}

async fn post_clean_zones(State(s): State<AppState>, Json(req): Json<ZonesReq>) -> impl IntoResponse {
    let tuya_zones: Vec<(i16, i16, i16, i16, u8)> = req
        .zones
        .iter()
        .map(|z| {
            let (tx1, ty1) = s.map.pixel_to_tuya(z.x1, z.y1);
            let (tx2, ty2) = s.map.pixel_to_tuya(z.x2, z.y2);
            (tx1.min(tx2), ty1.min(ty2), tx1.max(tx2), ty1.max(ty2), z.passes.unwrap_or(1))
        })
        .collect();
    match s.tuya.clean_zones(&tuya_zones).await {
        Ok(pkt) => (StatusCode::OK, Json(json!({"status": "ok", "success": true, "packet": pkt}))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))),
    }
}

async fn post_goto(State(s): State<AppState>, Json(req): Json<GotoReq>) -> impl IntoResponse {
    let (tx, ty) = s.map.pixel_to_tuya(req.x, req.y);
    match s.tuya.goto_point(tx, ty).await {
        Ok(pkt) => (
            StatusCode::OK,
            Json(json!({"status": "ok", "x": tx, "y": ty, "spot_clean": req.spot_clean.unwrap_or(false), "packet": pkt})),
        ),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))),
    }
}

async fn patch_room(
    State(s): State<AppState>,
    AxumPath(room_id): AxumPath<u32>,
    Json(req): Json<RoomPatchReq>,
) -> impl IntoResponse {
    match s.map.update_room(room_id, req.name, req.color, req.suction, req.water) {
        Some(room) => (StatusCode::OK, Json(json!({"status": "ok", "room": room}))),
        None => (StatusCode::NOT_FOUND, Json(json!({"error": "room not found"}))),
    }
}

async fn post_nogo(State(s): State<AppState>, Json(req): Json<NoGoReq>) -> Json<Value> {
    let z = s.map.add_nogo(req.x1, req.y1, req.x2, req.y2, req.name.unwrap_or_else(|| "No-Go Zone".into()));
    Json(json!({"status": "ok", "zone": z}))
}

async fn delete_nogo(State(s): State<AppState>, AxumPath(id): AxumPath<String>) -> impl IntoResponse {
    if s.map.delete_nogo(&id) {
        (StatusCode::OK, Json(json!({"status": "ok", "deleted": id})))
    } else {
        (StatusCode::NOT_FOUND, Json(json!({"error": "not found"})))
    }
}

async fn post_vwall(State(s): State<AppState>, Json(req): Json<VWallReq>) -> Json<Value> {
    let w = s.map.add_vwall(req.x1, req.y1, req.x2, req.y2);
    Json(json!({"status": "ok", "wall": w}))
}

async fn delete_vwall(State(s): State<AppState>, AxumPath(id): AxumPath<String>) -> impl IntoResponse {
    if s.map.delete_vwall(&id) {
        (StatusCode::OK, Json(json!({"status": "ok", "deleted": id})))
    } else {
        (StatusCode::NOT_FOUND, Json(json!({"error": "not found"})))
    }
}

async fn post_poop(State(s): State<AppState>, Json(req): Json<PoopReq>) -> Json<Value> {
    let h = s.map.add_poop(
        req.x,
        req.y,
        req.radius_px.unwrap_or(10.0),
        req.label.unwrap_or_else(|| "Pet Hazard".into()),
    );
    let boxes = s.map.all_nogo_tuya_boxes();
    let pkt = s.tuya.push_nogo_zones(&boxes).await.ok();
    Json(json!({"status": "ok", "hazard": h, "packet": pkt}))
}

async fn delete_poop(State(s): State<AppState>, AxumPath(id): AxumPath<String>) -> impl IntoResponse {
    if s.map.delete_poop(&id) {
        let boxes = s.map.all_nogo_tuya_boxes();
        let pkt = s.tuya.push_nogo_zones(&boxes).await.ok();
        (StatusCode::OK, Json(json!({"status": "ok", "deleted": id, "packet": pkt})))
    } else {
        (StatusCode::NOT_FOUND, Json(json!({"error": "not found"})))
    }
}

async fn post_push_nogo(State(s): State<AppState>) -> Json<Value> {
    let boxes = s.map.all_nogo_tuya_boxes();
    let pkt = s.tuya.push_nogo_zones(&boxes).await.ok();
    Json(json!({"status": "ok", "packet": pkt}))
}

async fn post_place(State(s): State<AppState>, Json(req): Json<PlaceCreateReq>) -> Json<Value> {
    let p = s.map.add_place(
        req.name,
        req.color.unwrap_or_else(|| "#38bdf8".into()),
        req.x1,
        req.y1,
        req.x2,
        req.y2,
        req.passes.unwrap_or(1),
    );
    Json(json!({"status": "ok", "place": p}))
}

async fn patch_place(
    State(s): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Json(req): Json<PlacePatchReq>,
) -> impl IntoResponse {
    match s.map.update_place(&id, req.name, req.color, req.passes) {
        Some(p) => (StatusCode::OK, Json(json!({"status": "ok", "place": p}))),
        None => (StatusCode::NOT_FOUND, Json(json!({"error": "not found"}))),
    }
}

async fn delete_place(State(s): State<AppState>, AxumPath(id): AxumPath<String>) -> impl IntoResponse {
    if s.map.delete_place(&id) {
        (StatusCode::OK, Json(json!({"status": "ok", "deleted": id})))
    } else {
        (StatusCode::NOT_FOUND, Json(json!({"error": "not found"})))
    }
}

async fn post_reset_traj() -> Json<Value> {
    Json(json!({"status": "ok"}))
}

async fn serve_static(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let target = if path.is_empty() { "index.html" } else { path };

    if let Some(file) = StaticAssets::get(target) {
        let mime = mime_guess::from_path(target).first_or_octet_stream();
        return ([(header::CONTENT_TYPE, mime.as_ref())], file.data).into_response();
    }
    if let Some(index) = StaticAssets::get("index.html") {
        return ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], index.data).into_response();
    }
    (StatusCode::NOT_FOUND, "React bundle missing (run cd web-ui && npm run build)").into_response()
}
