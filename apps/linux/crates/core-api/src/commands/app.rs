use serde::{Deserialize, Serialize};

empty_shape!(
    LifecycleSetVisibleResult,
    LifecycleSetOnlineResult,
    DeviceNameParams,
    NoticesDismissResult,
    NoticesPerformResult,
    AnalyticsVisitParams,
);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleSetVisibleParams {
    pub visible: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleSetOnlineParams {
    pub online: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceNameResult {
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoticeIdParams {
    pub id: String,
}

pub type NoticesDismissParams = NoticeIdParams;
pub type NoticesPerformParams = NoticeIdParams;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsVisitResult {
    pub url: Option<String>,
}

command!(
    LifecycleSetVisible,
    "lifecycle.setVisible",
    LifecycleSetVisibleParams,
    LifecycleSetVisibleResult
);
command!(
    LifecycleSetOnline,
    "lifecycle.setOnline",
    LifecycleSetOnlineParams,
    LifecycleSetOnlineResult
);
command!(
    DeviceName,
    "device.name",
    DeviceNameParams,
    DeviceNameResult
);
command!(
    NoticesDismiss,
    "notices.dismiss",
    NoticesDismissParams,
    NoticesDismissResult
);
command!(
    NoticesPerform,
    "notices.perform",
    NoticesPerformParams,
    NoticesPerformResult
);
command!(
    AnalyticsVisit,
    "analytics.visit",
    AnalyticsVisitParams,
    AnalyticsVisitResult
);
