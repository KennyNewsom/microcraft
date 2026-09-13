package microcraft;

import java.net.*;
import java.nio.charset.StandardCharsets;
import com.viaversion.viaversion.libs.gson.*;
import net.lenni0451.lambdaevents.EventHandler;
import net.raphimc.viaproxy.ViaProxy;
import net.raphimc.viaproxy.plugins.ViaProxyPlugin;
import net.raphimc.viaproxy.plugins.events.ClientLoggedInEvent;
import net.raphimc.viaproxy.proxy.packethandler.ChatSignaturePacketHandler;

/** Hands an authenticated profile to the local bridge before forwarding login. */
public final class MicrocraftIdentity extends ViaProxyPlugin {
    public void onEnable() { ViaProxy.EVENT_MANAGER.register(this); }

    @EventHandler
    public void login(ClientLoggedInEvent event) {
        var connection = event.getProxyConnection();
        // ViaProxy normally drops chat sessions on an unencrypted backend link.
        // This loopback backend authenticates via our handoff and validates the
        // original certificates/signatures itself, so relay them unchanged.
        connection.getC2P().eventLoop().execute(() -> connection.getPacketHandlers().removeIf(h -> h instanceof ChatSignaturePacketHandler));
        if (System.getenv("MICROCRAFT_IDENTITY_URL") == null) return;
        try {
            var profile = connection.getGameProfile();
            var body = new JsonObject();
            body.addProperty("port", ((InetSocketAddress) connection.getChannel().localAddress()).getPort());
            body.addProperty("uuid", profile.getId().toString());
            body.addProperty("name", profile.getName());
            body.addProperty("authenticated", ViaProxy.getConfig().isProxyOnlineMode());
            var properties = new JsonArray();
            for (var property : profile.getProperties().values()) {
                var p = new JsonObject();
                p.addProperty("name", property.name());
                p.addProperty("value", property.value());
                if (property.hasSignature()) p.addProperty("signature", property.signature());
                properties.add(p);
            }
            body.add("properties", properties);
            var request = (HttpURLConnection) URI.create(System.getenv("MICROCRAFT_IDENTITY_URL")).toURL().openConnection();
            request.setConnectTimeout(2000);
            request.setReadTimeout(2000);
            request.setRequestMethod("POST");
            request.setRequestProperty("Authorization", "Bearer " + System.getenv("MICROCRAFT_IDENTITY_TOKEN"));
            request.setDoOutput(true);
            try {
                try (var out = request.getOutputStream()) { out.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
                if (request.getResponseCode() != 204) throw new Exception("Identity handoff rejected");
            } finally { request.disconnect(); }
        } catch (Exception error) {
            connection.kickClient("Microcraft identity handoff failed. Please reconnect.");
        }
    }
}
