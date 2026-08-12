use std::collections::HashMap;
use std::sync::RwLock;

use tokio::sync::broadcast;

const SSE_CHANNEL_CAPACITY: usize = 256;

pub struct SseHub {
    channels: RwLock<HashMap<String, broadcast::Sender<()>>>,
}

impl SseHub {
    pub fn new() -> Self {
        Self {
            channels: RwLock::new(HashMap::new()),
        }
    }

    pub fn sender(&self, vault_id: &str) -> broadcast::Sender<()> {
        if let Some(tx) = self.channels.read().unwrap().get(vault_id) {
            if tx.receiver_count() > 0 {
                return tx.clone();
            }
        }
        let mut channels = self.channels.write().unwrap();
        if let Some(tx) = channels.get(vault_id) {
            if tx.receiver_count() > 0 {
                return tx.clone();
            }
        }
        let (tx, _) = broadcast::channel(SSE_CHANNEL_CAPACITY);
        channels.insert(vault_id.to_string(), tx.clone());
        tx
    }

    pub fn subscribe(&self, vault_id: &str) -> broadcast::Receiver<()> {
        let mut channels = self.channels.write().unwrap();
        let tx = match channels.get(vault_id) {
            Some(t) if t.receiver_count() > 0 => t.clone(),
            _ => {
                let (tx, _) = broadcast::channel(SSE_CHANNEL_CAPACITY);
                channels.insert(vault_id.to_string(), tx.clone());
                tx
            }
        };
        let rx = tx.subscribe();
        drop(channels);
        rx
    }

    pub fn broadcast(&self, vault_id: &str) {
        let _ = self.sender(vault_id).send(());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn broadcast_delivers_to_subscribers() {
        let hub = SseHub::new();
        let mut rx = hub.sender("vault-a").subscribe();
        hub.broadcast("vault-a");
        rx.recv().await.unwrap();
    }

    #[tokio::test]
    async fn vaults_do_not_cross_talk() {
        let hub = SseHub::new();
        let mut rx = hub.sender("vault-a").subscribe();
        hub.broadcast("vault-b");
        let timed = tokio::time::timeout(std::time::Duration::from_millis(50), rx.recv()).await;
        assert!(timed.is_err());
    }

    #[tokio::test]
    async fn subscribe_shares_one_channel_for_two_subscribers() {
        let hub = SseHub::new();
        let mut rx1 = hub.subscribe("vault-x");
        let mut rx2 = hub.subscribe("vault-x");
        let channels = hub.channels.read().unwrap();
        assert_eq!(channels.len(), 1);
        drop(channels);
        hub.broadcast("vault-x");
        rx1.recv().await.unwrap();
        rx2.recv().await.unwrap();
    }

    #[tokio::test]
    async fn subscribe_after_last_drop_registers_on_fresh_channel() {
        let hub = SseHub::new();
        {
            let _rx = hub.subscribe("vault-y");
        }
        let mut rx = hub.subscribe("vault-y");
        hub.broadcast("vault-y");
        rx.recv().await.unwrap();
    }
}
