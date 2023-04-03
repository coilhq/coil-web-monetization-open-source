# Redeemer (Anonymous token service)

The `redeemer` service can be used to improve privacy by protecting the user's identity from our servers when ILP micropayments are made. It allows users to redeem anonymous tokens for authorization for our connector.

# How does it work?

A scheme can be performed in the extension where the extension generates a set of random tokens. We'll call these anonymous userIds. The extension will then hash and blind each of these anonymous userIds (https://en.wikipedia.org/wiki/Blind_signature) and submit them to the redeemer service. When these are submitted the user is authenticated as themselves, but because of the blinding the redeemer will not know what the anonymous userIds are.

For each of the blinded anonymous userIds, the redeemer service will increment the user's spent balance in redis by some amount (probably a minute's worth of traffic, or $0.006). If the user is close to their maximum amount then the request will fail. If the increment is successful then the redeemer will sign the blinded anonymous userId with an RSA key which is unique to the current month. The signature is returned.

Now the user unblinds the signature. The result is that they have a signed anonymous userId, but Coil's servers don't know the owner of that anonymous userId. The extension will likely keep a hoard of anonymous userIds on hand to be used for Web Monetization. We don't want to use them immediately because we want to prevent timing attacks where you can correlate signing of a blinded anonymous user Id to the actual usage of it.

When the user visits a web monetized site, they submit an anonymous userId to the redeemer service (not blinded) along with the unblinded signature. The redeemer service verifies the signature to check that it had signed it. It ensures that the key used was either this month's RSA key or last month's, so that the anonymous userIds are not valid forever. If the verification succeeds then the redeemer service returns a BTP token that the user can use.

The user connects to the connector with the BTP token as usual, except instead of their userId it's using their anonymous userId. The anonymous userId has a maximum aggregate balance of $0.006, the same amount which was added to the user's balance when they created the anonymous userId. Once the anonymous userId is used up, they throw it away and connect again with the next one.

## Flow

1. Issue (setup)
  1. Client generates 10 random tokens (called anonymous `userId`s).
  2. Client hashes and blinds the 10 anonymous `userId`s.
  3. Client posts blinded `userId`s to `<issuer>/issuer/issue`.
  4. Issuer spends 1 minute of balance for each blinded `userId` received.
  5. Issuer returns the signatures of the blinded `userId`s.
2. Redeem
  1. Client unblinds one of the signatures.
  2. Client sends signed anonymous `userId` to the Redeemer.
  3. Redeemer returns a BTP token valid for 1 minute of payment.
  4. When the BTP token runs out of money, repeat.

# HTTP API

The redeemer service exposes two ports, one for the signing API and one for the redeeming API. The reason for this is we'll want to put the signing API on the ordinary coil origin, and the redeeming API on a different origin, one where cookies will not be sent and the user's IP will be hidden from our servers.

## Signing API

### Sign Blinded Message Hash

Submit a blinded hash of your anonymous user ID and get a signature in return. This comes with the month-year identifier so that the service can look up the correct key when you submit the signature for verification.

```http
POST /issuer/issue HTTP/1.1
Accept: application/json, */*
Accept-Encoding: gzip, deflate
Connection: keep-alive
Content-Length: 1275
Content-Type: application/json
Host: localhost:8080
User-Agent: HTTPie/1.0.3
{
  "bl_sig_req": "eyJ0eXBlIjoiSXNzdWUiLCJjb250ZW50cyI6WyJCRVB4NkpkSldSY0dFZUQ3RDk0Z2dwMGgrRWVhclNXbDhYeHo5WTBxQUczMXYxbXlwczIzbUdKNlhHeFFDYWR5Uk5Wc2xmUCtWMlVXWUZ4cGgyRHhycXM9IiwiQkJOOXJBemZEYi9yVXI2d0NNTE1FMncxOHplUVZxTVY2a0owUHVJN1dZTzlBUFk2N2ozaTRGdm5rZzVzN0E3dVNlOWJGaDRCWHAvTG93eTRYdGdVREtNPSIsIkJKRVNMS09zMHlJYlIvWFU5ZExOY2FZanFpZjVxVndtZ2hoNjZ1NGtML25tN3U5eDRDNG11M3NHWTdCaWNxNTd1VmxSOUtldTdrbm9CVlh5R1BnQkcrWT0iLCJCRmNIVjhxTTJTT1l6L1RnV3V5Zm9mMTJqK0NkM3M4RXJNOFNRR1p1SlZiRUlKZlF4SHZIY0Fua1p4M3MyUWFDeWQycjh4M1E1bklkWEtZYUloWERHMjA9IiwiQkxVYlhiTFhDQXhYYkRudm4vT2s1Q09MYVBNSXhSU0UrMzU3Y3dEMWtaS2c5V0N4Z3ZiaXBwazRIZWFTQVRVMk5qWkREY0E1aDg0SzhhVmFDS2NZRm13PSIsIkJEYXZGYTExN3RqeVdDS1hxcEo3WFJjQ1pmbTVIeUFqZm9ScXBXRlNFd2tIWHhmVEZZT3EzcmRRaXFOalRLVmVUb2RPSjZvdGFhTlBETUx6blhpUWlLQT0iLCJCUCs4SFR3L2tZZVEzaERKenpSUE1zQ3V6aEVoQkpJS1V1OG5mWXA5M1Y5WVEvdFBNK2VRZHlFMDY3cjhITVNTZlprcS9TcWd4QjNDdDFyS2dydUs5VGc9IiwiQkUrQ3BKTXdFSWVxK0tseDg3Rm1obUt1NzFhQnhPLy8rN3p4QXRkNTZ5L1hrWnUvY0lScHEwdDRkVHBLMmljN2xlVnZZTDVpQXdpZzJ0YnhMRUovM05jPSIsIkJKbjZTZVl4bmsycmJ5WGlGTitTa2piaGxpVVZucU5PMWc2MGIyaGc5YXRGR2RWbStObmoyZk5XZkl2Z1A4cmhQUWpHTDBJbUJSVFczYzUrNjBzejEwWT0iLCJCREprbmRFOWNzSzNmL2ZZL2xKVkpMK1U0Z2JEeWl0aUFSZUJySUVYb0V2ZlVxNERTVjhrcWpLeUI2NGp1YVNSTDAzVkJ0OENza1ZDQlpSaG9Ld3JXZUk9Il19"
}

HTTP/1.1 200 OK
Connection: keep-alive
Content-Length: 161
Content-Type: application/json; charset=utf-8
Date: Tue, 29 Oct 2019 00:37:12 GMT
X-Powered-By: Express
{
  "sigs": [
    "BAc7KWE6G9f6fgYNPj4YN9UHK3kskGXVx7oGGqiWd1S08D8xIZMy2BbCIsAFGy1ZCTmYdi5lncNntcm2txVyaP0=",
    "BHYbXTkdWgF8+/xvDDRuAlrsc8qWExGCPY7ieJdaQ77K7neYTXQN8gbkEIPkiNZ5N9wV9DUkJ4NYibhsKYSJX5U=",
    "BHwQRS3G9oiBvJ5UxwLss7hsJM8kJs0Oh3APPPnTAiS2XHSbnl+69Xwg2zJ5BR99yNsEGK5tGjmKojpjGOLv3HM=",
    "BJv/RdTdnOWVgtm/KFh8SK2EmqugL+CMca/s+gSeSQMS41XZQ1cz0W5GT1A5IQfs+7HOM+WsRa9p2jR0dxISOM0=",
    "BMmROQiegI0e7w5rDXORzkk17MlAwkS7onAgeMXrOdP7U/1d+5kMTyQigasdfnWTeWkNfFMM4dVY2mPOoTfVUUY=",
    "BJlx9iMbzf0qcCQOu2FJ/d6eaSGcU+lVXp1ZIQDRGSGzKLuBo7BgKi9Vvrv25yF2Y2NuvUOURsGvyJVevKQc9EI=",
    "BPKP2xCiO3eAUDlwsYKgpCDkJeIVjZ20chBQA3dCEocu1wLy7stS6RuRCFb5X0+1Bi1fTru1PSrRL4iAk5zuTaI=",
    "BC5kjJqKC2ryzcXcNifZhDzsJ99jb1FFI/i+aCKAa3trMSPd+qSs40nDkyYMioCh+eZGy8AcXAxFu/l7J0x/zv8=",
    "BMC0Ydc3Vx2EqjVZmwnQZue3l/5zETXG922HZo/ao9BzjSUH0Jy4N2FfdchJut2ZRBBEnIEg619JxKaId/enT4A=",
    "BHeatCnugjoPyTnFI8Uyjn0QsDDwbMWbt8PdNG20kWUIVGttbJQm51G01Px9xPFqAL8WONOMpHbzr6vVHM3IWq8="
  ],
  "proof": "YmF0Y2gtcHJvb2Y9eyJQIjoiZXlKU0lqb2lZM1ZwZUU1Mk15dGlSbU52YkZsM1VXOVFSR2RDTDJ4emRVSlpXRTQzU1ZCaWJqQTNPVWhFWjAxaWN6MGlMQ0pESWpvaVltbDNhRUprZWpObk0xUkllRTU0YUdSSmJpdE1XVzk1Y2l0eWNISjRTa3B2VDBwbWVIVkZVbkY2UlQwaWZRPT0ifQ==",
  "version": "1.0"
}
```

## Redeeming API

The redeeming API has been separated out so that it can be put behind a protected proxy that will stop us from seeing user IP addresses and user agents.

### Redeem Signature for Connector Authorization

The `/redeemer/redeem` endpoint takes as input your timestamped signature and the unblinded anonymous user ID. It verifies the signature using the key, and returns a BTP token. This BTP token can be used to authenticate to Coil's connector just like the kind of BTP token you get from the coil-api service. Unlike that BTP token, however, this one is fully anonymous. It cannot be tied back to the userId on your profile.

```http
POST /redeemer/redeem HTTP/1.1
Accept: application/json, */*
Accept-Encoding: gzip, deflate
Connection: keep-alive
Content-Length: 202
Content-Type: application/json
Host: localhost:8081
User-Agent: HTTPie/1.0.3
{
    "bl_sig_req": "eyJ0eXBlIjoiUmVkZWVtIiwiY29udGVudHMiOlsiY0REdWoveGNoWlIvUm5yTFdNUjh3S2lrQUhONDE2V2RuSTVzV215VVZSQT0iLCJyQmFTZkMxWCtmN3FJNlJmRlAwR3JOR2lURUdvcVRyN01VbWxRamVTTm9nPSJdfQ=="
}

HTTP/1.1 200 OK
Connection: keep-alive
Content-Length: 289
Content-Type: application/json; charset=utf-8
Date: Wed, 06 Nov 2019 00:10:20 GMT
X-Powered-By: Express
{
    "token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJhbm9uOmNERHVqL3hjaFpSL1JuckxXTVI4d0tpa0FITjQxNldkbkk1c1dteVVWUkE9IiwidGhyb3VnaHB1dCI6MTg2LCJhZ2ciOjExMTYwLCJjdXJyZW5jeSI6IlVTRCIsInNjYWxlIjo5LCJhbm9uIjp0cnVlLCJpYXQiOjE1ODQ3MzkwNTksImV4cCI6MTU4NDc0MjY1OX0.DxMfti2_nHwqyWZeH-sAj9o4R0owAELfis1EiOCE9hE"
}
```

# Generating Keys/Commitments

To generate the keys/commitments, run:

```
$ ./scripts/generate-key.sh /path/to/challenge-bypass-server/ 12
```

where `12` is the number of months to generate. The YAML that is printed should be added to `resources/terraform/staging-deploy/helm_vars/cbs/secrets.yaml` (or `production-deploy`) (edit with `sops`). Then repeat for the other bandwidth.

**Warning**: Do not remove keys unless they are more than a month old. Do not add duplicate keys.
