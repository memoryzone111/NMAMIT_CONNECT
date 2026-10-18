package com.nmamit.connect

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class SupabaseDisplayApi(
    private val baseUrl: String,
    private val publishableKey: String
) {
    private fun post(path: String, body: JSONObject): JSONObject {
        val connection = URL(
            "${baseUrl.trimEnd('/')}/functions/v1/$path"
        ).openConnection() as HttpURLConnection

        connection.requestMethod = "POST"
        connection.connectTimeout = 15000
        connection.readTimeout = 20000
        connection.doOutput = true
        connection.setRequestProperty("apikey", publishableKey)
        connection.setRequestProperty(
            "Authorization", "Bearer $publishableKey"
        )
        connection.setRequestProperty(
            "Content-Type", "application/json"
        )
        connection.setRequestProperty("Accept", "application/json")

        try {
            connection.outputStream.use {
                it.write(body.toString().toByteArray(Charsets.UTF_8))
            }

            val status = connection.responseCode
            val stream = if (status in 200..299) {
                connection.inputStream
            } else {
                connection.errorStream
            }

            val response = stream?.bufferedReader()?.use {
                it.readText()
            } ?: "{}"

            if (status !in 200..299) {
                throw Exception("Supabase request failed (HTTP $status)")
            }

            return JSONObject(response)
        } finally {
            connection.disconnect()
        }
    }

    fun redeemPairingCode(
        displayCode: String,
        pairingCode: String
    ): JSONObject {
        return post(
            "redeem-pairing-code",
            JSONObject()
                .put("display_code", displayCode.trim())
                .put("pairing_code", pairingCode.trim())
        )
    }

    fun authenticate(credential: String): JSONObject {
        return post(
            "authenticate-display",
            JSONObject().put("credential", credential)
        )
    }
fun registerDisplay(
    displayCode: String,
    credential: String,
    playerVersion: String,
    androidApiLevel: Int
): JSONObject {
    return post(
        "register-display",
        JSONObject()
            .put("display_code", displayCode)
            .put("credential", credential)
            .put("player_version", playerVersion)
            .put("android_api_level", androidApiLevel)
    )
}

fun rotateDisplayQr(
    displayCode: String,
    credential: String,
    qrCode: String
): JSONObject {
    return post(
        "rotate-display-qr",
        JSONObject()
            .put("display_code", displayCode)
            .put("credential", credential)
            .put("qr_code", qrCode)
    )
}

fun claimDisplay(
    displayCode: String,
    qrCode: String,
    name: String,
    locationLabel: String
): JSONObject {
    return post(
        "claim-display",
        JSONObject()
            .put("display_code", displayCode)
            .put("qr_code", qrCode)
            .put("name", name)
            .put("location_label", locationLabel)
    )
}
fun rotateDisplayRegistration(
    oldDisplayCode: String,
    oldCredential: String,
    newDisplayCode: String,
    newCredential: String,
    playerVersion: String,
    androidApiLevel: Int
): JSONObject {
    return post(
        "rotate-display-registration",
        JSONObject()
            .put("old_display_code", oldDisplayCode)
            .put("old_credential", oldCredential)
            .put("new_display_code", newDisplayCode)
            .put("new_credential", newCredential)
            .put("player_version", playerVersion)
            .put("android_api_level", androidApiLevel)
    )
}
}
