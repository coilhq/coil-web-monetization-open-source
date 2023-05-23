# Web Monetization

This is Coil's implementation of the [Web Monetization W3C Proposed Standard](https://webmonetization.org/specification.html).

Coil's extension source code has been transferred to the ILF in
the [Web Monetization Projects Github Repo](https://github.com/interledger/web-monetization-projects).

# Summary

The key part of Coil's Web Monetization implementation is the Redeemer service.
The `redeemer` service can be used to improve privacy by protecting the user's identity from
Coil's servers when ILP micropayments are made. It allows users to redeem
anonymous tokens for authorization for Coil's connector.

# How does it work?

A scheme (based on the first version of [privacypass](https://privacypass.github.io/)) can be performed in the extension where the extension generates a set of random tokens. We'll call these anonymous userIds. The extension will then hash and blind each of these anonymous userIds and submit them to the redeemer service. When these are submitted the user is authenticated as themselves, but because of the blinding the redeemer will not know what the anonymous userIds are.

For each of the blinded anonymous userIds, the redeemer service will increment the user's spent balance in redis by some amount (probably a minute's worth of traffic, or $0.006). If the user is close to their maximum amount then the request will fail. If the increment is successful then the redeemer will sign the blinded anonymous userId with a signing key which is unique to the current month. The signature is returned.

Now the user unblinds the signature. The result is that they have a signed anonymous userId, but Coil's servers don't know the owner of that anonymous userId. The extension will likely keep a hoard of anonymous userIds on hand to be used for Web Monetization. We don't want to use them immediately because we want to prevent timing attacks where you can correlate signing of a blinded anonymous user Id to the actual usage of it.

When the user visits a web monetized site, they submit an anonymous userId to the redeemer service (not blinded) along with the unblinded signature. The redeemer service verifies the signature to check that it had signed it. It ensures that the key used was either this month's signing key or last month's, so that the anonymous userIds are not valid forever. If the verification succeeds then the redeemer service returns a BTP token that the user can use.

The user connects to the connector with the BTP token as usual, except instead of their userId it's using their anonymous userId. The anonymous userId has a maximum aggregate balance of $0.006, the same amount which was added to the user's spent balance when they created the anonymous userId. Once the anonymous userId is used up, they throw it away and connect again with the next one.

# Redeemer Flow
### Issue (setup)
1. Client generates 10 random tokens (called anonymous `userId`s).
2. Client hashes and blinds the 10 anonymous `userId`s.
3. Client posts blinded `userId`s to `<issuer>/issuer/issue`.
4. Issuer spends 1 minute of balance for each blinded `userId` received.
5. Issuer returns the signatures of the blinded `userId`s.

### Redeem
1. Client unblinds one of the signatures.
2. Client sends signed anonymous `userId` to the Redeemer.
3. Redeemer returns a BTP token valid for 1 minute of payment.
4. When the BTP token runs out of money, repeat.

The complete Web Monetization Service provided by Coil involves more than just the redeemer service.
We have created a sequence diagram to show how all our services work together to provide Web Monetization.

# Full Sequence Diagram
It's suggested that you Download this diagram locally for better viewing or to load the source into [Excalidraw](https://app.excalidraw.com/)

Excalidraw Source File: [Web Mon Excalidraw](Web%20Mon%20Open%20Source.excalidraw)

![Web Monetization State Diagram](Web%20Mon%20Open%20Source.png)

# Services

These have been included as examples of some of the services needed as part of Coil's Web Monetization Implementation.

The `services` directory contains:

* `cbs` Challenge Bypass Server
* `connector` Sample ILP Connector
* `redeemer` Redeemer
* `redeemer-privacy-worker` CloudFlare Worker
* `spsp-server` SPSP Server
  The SPSP server is an example service that does payouts of streaming payments via ILP.

The `packages` directory contains:

* `redis` The redis package used by `redeemer`
  Handles controlling the bucket throughput for Web Monetization
* `metrics` Coil specific package used to report metrics to monitoring services to ensure uptime
  NOTE: This package is not included in this repository
