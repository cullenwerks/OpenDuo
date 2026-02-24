use anyhow::{anyhow, Result};

pub fn validate_chat_request(message: &str) -> Result<()> {
    if message.trim().is_empty() {
        return Err(anyhow!("Message cannot be empty"));
    }
    if message.len() > 10_000 {
        return Err(anyhow!("Message exceeds maximum length of 10,000 characters"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rejects_empty_message() {
        assert!(validate_chat_request("").is_err());
    }

    #[test]
    fn test_rejects_overlong_message() {
        let long = "x".repeat(10_001);
        assert!(validate_chat_request(&long).is_err());
    }

    #[test]
    fn test_accepts_valid_message() {
        assert!(validate_chat_request("List my open issues").is_ok());
    }
}
